// ===== Calendar / Planner =====
// CRUD for CalendarEvent rows + ICS import/export.
// Mirrors routes/tasks.ts conventions (Hono + authMiddleware + zValidator).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import { cleanupOrphanLinks } from "../db/links";

const calendar = new Hono();
calendar.use("*", authMiddleware, appTierGate("calendar"));

const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(""),
  start: z.string().datetime(),
  end: z.string().datetime(),
  allDay: z.boolean().optional().default(false),
  color: z.string().optional().default("#6366f1"),
  location: z.string().optional().default(""),
  source: z.string().optional().default("manual"),
  sourceRef: z.string().optional().default(""),
});

// GET /feed?from=&to=  — events overlapping [from, to]
calendar.get("/feed", async (c) => {
  const { userId } = c.get("auth");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const where: Record<string, unknown> = { userId };
  if (from || to) {
    const range: Record<string, unknown> = {};
    if (from) range.gte = new Date(from);
    if (to) range.lte = new Date(to);
    where.start = range;
  }
  const events = await prisma.calendarEvent.findMany({
    where: where as never,
    orderBy: { start: "asc" },
  });
  return c.json({ events });
});

calendar.get("/", async (c) => {
  const { userId } = c.get("auth");
  const events = await prisma.calendarEvent.findMany({
    where: { userId },
    orderBy: { start: "asc" },
  });
  return c.json({ events });
});

calendar.post("/", zValidator("json", eventSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    const event = await prisma.calendarEvent.create({
      data: {
        ...body,
        userId,
        start: new Date(body.start),
        end: new Date(body.end),
      } as never,
    });
    return c.json({ event }, 201);
  } catch (e) {
    console.error("[calendar] create error:", e);
    return c.json({ error: (e as Error).message }, 500);
  }
});

calendar.patch("/:id", zValidator("json", eventSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const data: Record<string, unknown> = { ...body };
  if (body.start) data.start = new Date(body.start);
  if (body.end) data.end = new Date(body.end);
  const event = await prisma.calendarEvent.update({
    where: { id: c.req.param("id"), userId },
    data: data as never,
  });
  return c.json({ event });
});

calendar.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  await prisma.calendarEvent.delete({ where: { id, userId } });
  await cleanupOrphanLinks(userId, "calendarEvent", id);
  return c.json({ ok: true });
});

// ===== ICS import/export =====
// Minimal RFC 5545 parser + generator. Supports single VEVENTs and simple
// recurrence (FREQ=DAILY/WEEKLY/MONTHLY with UNTIL or COUNT). Recurring
// events are expanded into the visible range on import so the DB stores
// concrete rows (simpler queries, no recurrence engine at read time).

interface ParsedIcsEvent {
  uid: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string;
  rrule?: string;
}

function parseIcsDate(value: string, allDay: boolean): Date {
  // YYYYMMDDTHHMMSSZ  or  YYYYMMDD
  if (allDay) {
    return new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`
    );
  }
  const v = value.replace(/Z$/, "");
  return new Date(
    `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(
      11,
      13
    )}:${v.slice(13, 15)}Z`
  );
}

function unfoldIcs(text: string): string {
  // RFC 5545 line folding: a CRLF followed by a space/tab continues the line.
  return text.replace(/\r?\n[ \t]/g, "");
}

function parseIcs(text: string): ParsedIcsEvent[] {
  const unfolded = unfoldIcs(text);
  const events: ParsedIcsEvent[] = [];
  const lines = unfolded.split(/\r?\n/);
  let inEvent = false;
  let cur: {
    uid?: string;
    summary?: string;
    description?: string;
    location?: string;
    rrule?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
  } = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (cur.summary && cur.start) {
        events.push({
          uid: cur.uid ?? crypto.randomUUID(),
          summary: cur.summary,
          description: cur.description ?? "",
          start: new Date(cur.start),
          end: cur.end ? new Date(cur.end) : new Date(cur.start),
          allDay: Boolean(cur.allDay),
          location: cur.location ?? "",
          rrule: cur.rrule,
        });
      }
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const keyPart = trimmed.slice(0, colonIdx).toUpperCase();
    const value = trimmed.slice(colonIdx + 1);
    const key = keyPart.split(";")[0];
    const isDate = keyPart.includes("VALUE=DATE");
    if (key === "UID") cur.uid = value;
    else if (key === "SUMMARY") cur.summary = value;
    else if (key === "DESCRIPTION") cur.description = value;
    else if (key === "LOCATION") cur.location = value;
    else if (key === "RRULE") cur.rrule = value;
    else if (key === "DTSTART") {
      cur.start = parseIcsDate(value, isDate).toISOString();
      cur.allDay = isDate;
    } else if (key === "DTEND") {
      cur.end = parseIcsDate(value, isDate).toISOString();
    }
  }
  return events;
}

function expandRecurrence(
  ev: ParsedIcsEvent,
  rangeStart: Date,
  rangeEnd: Date
): { start: Date; end: Date }[] {
  if (!ev.rrule) return [{ start: ev.start, end: ev.end }];
  const parts = Object.fromEntries(
    ev.rrule.split(";").map((p) => p.split("="))
  );
  const freq = parts.FREQ;
  const interval = parseInt(parts.INTERVAL ?? "1", 10) || 1;
  const count = parts.COUNT ? parseInt(parts.COUNT, 10) : Infinity;
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL, parts.UNTIL.length === 8) : null;
  const duration = ev.end.getTime() - ev.start.getTime();
  const out: { start: Date; end: Date }[] = [];
  let cur = new Date(ev.start);
  let n = 0;
  // Cap at 365 occurrences to avoid runaway loops.
  while (n < count && n < 365) {
    if (until && cur.getTime() > until.getTime()) break;
    if (cur.getTime() > rangeEnd.getTime()) break;
    if (cur.getTime() >= rangeStart.getTime() - duration) {
      out.push({ start: new Date(cur), end: new Date(cur.getTime() + duration) });
    }
    n++;
    if (freq === "DAILY") cur = new Date(cur.getTime() + interval * 86400000);
    else if (freq === "WEEKLY") cur = new Date(cur.getTime() + interval * 7 * 86400000);
    else if (freq === "MONTHLY") {
      cur = new Date(cur.getFullYear(), cur.getMonth() + interval, cur.getDate());
    } else break;
  }
  return out.length ? out : [{ start: ev.start, end: ev.end }];
}

const importSchema = z.object({
  ics: z.string().min(1),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

calendar.post("/ics/import", zValidator("json", importSchema), async (c) => {
  const { userId } = c.get("auth");
  const { ics, from, to } = c.req.valid("json");
  const rangeStart = from ? new Date(from) : new Date(Date.now() - 365 * 86400000);
  const rangeEnd = to ? new Date(to) : new Date(Date.now() + 365 * 86400000);
  const parsed = parseIcs(ics);
  let created = 0;
  for (const ev of parsed) {
    const occurrences = expandRecurrence(ev, rangeStart, rangeEnd);
    for (const occ of occurrences) {
      await prisma.calendarEvent.create({
        data: {
          userId,
          title: ev.summary.slice(0, 200),
          description: ev.description,
          start: occ.start,
          end: occ.end,
          allDay: ev.allDay,
          color: "#6366f1",
          location: ev.location,
          source: "ics",
          sourceRef: ev.uid,
        },
      });
      created++;
    }
  }
  return c.json({ imported: created });
});

function fmtIcsDate(d: Date, allDay: boolean): string {
  if (allDay) {
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

calendar.get("/ics/export", async (c) => {
  const { userId } = c.get("auth");
  const events = await prisma.calendarEvent.findMany({
    where: { userId },
    orderBy: { start: "asc" },
  });
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mavino Student OS//Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.id}@athena`,
      `DTSTAMP:${now}`,
      `DTSTART${ev.allDay ? ";VALUE=DATE" : ""}:${fmtIcsDate(ev.start, ev.allDay)}`,
      `DTEND${ev.allDay ? ";VALUE=DATE" : ""}:${fmtIcsDate(ev.end, ev.allDay)}`,
      `SUMMARY:${escapeIcs(ev.title)}`,
      `DESCRIPTION:${escapeIcs(ev.description)}`,
      `LOCATION:${escapeIcs(ev.location)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  const body = lines.join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="athena-calendar.ics"',
    },
  });
});

export default calendar;
