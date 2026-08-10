// ===== Athena calendar tools =====
// list_calendar_events, create_calendar_event, schedule_task,
// find_free_slots, open_calendar.

import { type ToolDef, paidOnly } from "./plugin";
import prisma from "../../../db/client";
import { fetchTimetable, isVutAuthenticated } from "../../../services/vut";
import { getVutGrant } from "../../../services/features";
import { isMicrosoftConfiguredFor, listEvents as msListEvents } from "../../../services/microsoft";

// Calendar is a Paid-tier app — all calendar tools are paid-only.
export const calendarTools: ToolDef[] = paidOnly([
  {
    name: "list_calendar_events",
    description:
      "List the user's calendar events in a date range. Returns id, title, start, end, allDay, source.",
    parameters: [
      { name: "from", type: "string", description: "ISO 8601 datetime (inclusive)" },
      { name: "to", type: "string", description: "ISO 8601 datetime (inclusive)" },
    ],
    handler: async (args, { userId }) => {
      const where: Record<string, unknown> = { userId };
      const range: Record<string, unknown> = {};
      if (args.from) range.gte = new Date(String(args.from));
      if (args.to) range.lte = new Date(String(args.to));
      if (Object.keys(range).length) where.start = range;
      const events = await prisma.calendarEvent.findMany({
        where: where as never,
        orderBy: { start: "asc" },
        take: 100,
      });
      return {
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          allDay: e.allDay,
          source: e.source,
          sourceRef: e.sourceRef,
          location: e.location,
        })),
      };
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Create a calendar event. Use when the user wants to schedule something at a specific time (a study session, meeting, reminder).",
    parameters: [
      { name: "title", type: "string", description: "Event title", required: true },
      { name: "start", type: "string", description: "ISO 8601 datetime", required: true },
      { name: "end", type: "string", description: "ISO 8601 datetime", required: true },
      { name: "allDay", type: "boolean", description: "All-day event?" },
      { name: "description", type: "string", description: "Longer description" },
      { name: "location", type: "string", description: "Location text" },
    ],
    handler: async (args, { userId }) => {
      const event = await prisma.calendarEvent.create({
        data: {
          userId,
          title: String(args.title ?? "").slice(0, 200),
          description: String(args.description ?? ""),
          start: new Date(String(args.start)),
          end: new Date(String(args.end)),
          allDay: Boolean(args.allDay),
          location: String(args.location ?? ""),
          source: "manual",
        },
      });
      return { event, created: true };
    },
  },
  {
    name: "schedule_task",
    description:
      "Schedule an existing task into a calendar time slot (a study/work session). Creates a calendar event linked to the task and opens the Calendar app.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "taskId", type: "string", description: "Task id from list_tasks", required: true },
      { name: "start", type: "string", description: "ISO 8601 datetime for the session start", required: true },
      { name: "end", type: "string", description: "ISO 8601 datetime for the session end", required: true },
    ],
    handler: async (args, { userId }) => {
      const task = await prisma.task.findUnique({
        where: { id: String(args.taskId), userId },
      });
      if (!task) return { error: "Task not found" };
      const start = new Date(String(args.start));
      const end = new Date(String(args.end));
      const event = await prisma.calendarEvent.create({
        data: {
          userId,
          title: `Study: ${task.title}`,
          description: task.description,
          start,
          end,
          source: "task",
          sourceRef: task.id,
          color: "#f59e0b",
        },
      });
      return {
        event,
        task: { id: task.id, title: task.title },
        action: "open_calendar",
        date: start.toISOString(),
      };
    },
  },
  {
    name: "find_free_slots",
    description:
      "Find free time slots on a given day, accounting for the user's calendar events and (if connected) VUT timetable classes. Returns available windows of at least the requested duration.",
    parameters: [
      { name: "date", type: "string", description: "ISO 8601 date (e.g. 2026-07-22)", required: true },
      { name: "durationMinutes", type: "number", description: "Minimum slot length in minutes (default 60)" },
    ],
    handler: async (args, { userId }) => {
      const dateStr = String(args.date).slice(0, 10);
      const dayStart = new Date(`${dateStr}T06:00:00Z`);
      const dayEnd = new Date(`${dateStr}T22:00:00Z`);
      const minMinutes = Number(args.durationMinutes ?? 60);

      const busy: { start: Date; end: Date }[] = [];
      const events = await prisma.calendarEvent.findMany({
        where: {
          userId,
          start: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { start: "asc" },
      });
      for (const e of events) busy.push({ start: e.start, end: e.end });

      // Merge VUT classes for the day if authenticated + granted access.
      if (isVutAuthenticated(userId) && (await getVutGrant(userId))) {
        try {
          const slots = await fetchTimetable(userId);
          const dayIndex = dayStart.getDay();
          const targetIdx = dayIndex === 0 ? 6 : dayIndex - 1;
          for (const s of slots) {
            if (s.dayIndex !== targetIdx) continue;
            const [sh, sm] = s.startTime.split(":").map(Number);
            const [eh, em] = s.endTime.split(":").map(Number);
            const start = new Date(dayStart);
            start.setUTCHours(sh, sm, 0, 0);
            const end = new Date(dayStart);
            end.setUTCHours(eh, em, 0, 0);
            busy.push({ start, end });
          }
        } catch {
          // ignore VUT errors — just use calendar
        }
      }

      busy.sort((a, b) => a.start.getTime() - b.start.getTime());
      const free: { start: string; end: string; minutes: number }[] = [];
      let cursor = new Date(dayStart);
      for (const b of busy) {
        if (b.start.getTime() > cursor.getTime()) {
          const mins = Math.round((b.start.getTime() - cursor.getTime()) / 60000);
          if (mins >= minMinutes) {
            free.push({
              start: cursor.toISOString(),
              end: b.start.toISOString(),
              minutes: mins,
            });
          }
        }
        if (b.end.getTime() > cursor.getTime()) cursor = new Date(b.end);
      }
      if (dayEnd.getTime() > cursor.getTime()) {
        const mins = Math.round((dayEnd.getTime() - cursor.getTime()) / 60000);
        if (mins >= minMinutes) {
          free.push({
            start: cursor.toISOString(),
            end: dayEnd.toISOString(),
            minutes: mins,
          });
        }
      }
      return { date: dateStr, requestedMinutes: minMinutes, freeSlots: free };
    },
  },
  {
    name: "open_calendar",
    description: "Open the Calendar app, optionally focused on a specific date.",
    clientAction: true,
    parameters: [
      { name: "date", type: "string", description: "ISO 8601 date to focus (e.g. 2026-07-22)" },
    ],
    handler: async (args, _ctx) => {
      return {
        action: "open_calendar",
        date: typeof args.date === "string" ? args.date : undefined,
      };
    },
  },
  {
    name: "sync_microsoft_calendar",
    description:
      "Sync events from the user's Microsoft (Outlook) calendar into the local calendar. Pulls events for a date range and upserts them. Returns the count of synced and deleted events.",
    destructive: true,
    parameters: [
      { name: "from", type: "string", description: "ISO 8601 datetime (defaults to 30 days ago)" },
      { name: "to", type: "string", description: "ISO 8601 datetime (defaults to 30 days from now)" },
    ],
    handler: async (args, { userId }) => {
      if (!(await isMicrosoftConfiguredFor(userId))) {
        return { error: "Microsoft Calendar is not configured. Add your credentials in Settings → Integrations." };
      }
      const from = args.from
        ? new Date(String(args.from))
        : new Date(Date.now() - 30 * 86400000);
      const to = args.to
        ? new Date(String(args.to))
        : new Date(Date.now() + 30 * 86400000);

      let msEvents;
      try {
        msEvents = await msListEvents(userId, from.toISOString(), to.toISOString());
      } catch (e) {
        return { error: `Microsoft sync failed: ${(e as { message?: string }).message ?? "unknown"}` };
      }

      const existing = await prisma.calendarEvent.findMany({
        where: {
          userId,
          source: "microsoft",
          start: { gte: from, lte: to },
        },
      });
      const msIds = new Set(msEvents.map((e) => e.id));
      const existingByRef = new Map(existing.map((e) => [e.sourceRef, e]));
      let upserted = 0;
      let deleted = 0;

      for (const ms of msEvents) {
        if (!ms.start?.dateTime || !ms.end?.dateTime) continue;
        const start = new Date(ms.start.dateTime);
        const end = new Date(ms.end.dateTime);
        const color = ms.showAs === "free" || ms.showAs === "tentative" ? "#94a3b8" : "#0ea5e9";
        const existingEvent = existingByRef.get(ms.id);
        if (existingEvent) {
          await prisma.calendarEvent.update({
            where: { id: existingEvent.id },
            data: {
              title: ms.subject || "(Untitled)",
              description: ms.body?.content ?? "",
              start,
              end,
              allDay: ms.isAllDay,
              location: ms.location?.displayName ?? "",
              color,
            },
          });
        } else {
          await prisma.calendarEvent.create({
            data: {
              userId,
              title: ms.subject || "(Untitled)",
              description: ms.body?.content ?? "",
              start,
              end,
              allDay: ms.isAllDay,
              location: ms.location?.displayName ?? "",
              color,
              source: "microsoft",
              sourceRef: ms.id,
            },
          });
        }
        upserted++;
        existingByRef.delete(ms.id);
      }
      for (const stale of existingByRef.values()) {
        await prisma.calendarEvent.delete({ where: { id: stale.id } });
        deleted++;
      }
      return { synced: upserted, deleted, range: { from: from.toISOString(), to: to.toISOString() } };
    },
  },
]);
