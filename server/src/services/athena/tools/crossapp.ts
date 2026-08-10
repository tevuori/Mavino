// ===== Athena cross-app composite tools =====
// Higher-level actions that bridge multiple apps: note→task, task→note,
// note→calendar review session. These compose existing Prisma models so the
// model can say "create a task from this note" in one tool call instead of
// read_note → create_task manually.

import type { ToolDef } from "./plugin";
import prisma from "../../../db/client";
import { resolveDefaultTaskWorkspace } from "./tasks";
import { getUserConfig, buildModel, acquireLlmModel } from "../llm";
import { generateJson, generateText } from "../../study/llm-json";
import { syllabusTasksPrompt, syllabusTasksSchemaHint, type SyllabusTaskSpec } from "../../study/prompts";

export const crossAppTools: ToolDef[] = [
  {
    name: "create_task_from_note",
    description:
      "Read a note and create a single actionable task from it. The LLM picks the most important action item. Use list_notes first to get the note id. Opens the Tasks app.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "noteId", type: "string", description: "Note id to create a task from", required: true },
      { name: "taskTitle", type: "string", description: "Optional explicit task title (skips LLM extraction)" },
      {
        name: "priority",
        type: "string",
        description: "Priority",
        enum: ["LOW", "MEDIUM", "HIGH"],
      },
      { name: "dueDate", type: "string", description: "ISO 8601 datetime" },
    ],
    handler: async (args, { userId }) => {
      const note = await prisma.note.findFirst({ where: { id: String(args.noteId), userId } });
      if (!note) return { error: "Note not found" };

      let title = String(args.taskTitle ?? "").trim();
      if (!title) {
        const cfg = await getUserConfig(userId);
        if (!cfg.apiKey) return { error: "No AI provider configured to extract a task title." };
        const { model } = await acquireLlmModel(userId);
        try {
          const result = await generateJson<{ tasks: SyllabusTaskSpec[] }>(
            model,
            syllabusTasksPrompt(note.content),
            syllabusTasksSchemaHint()
          );
          const tasks = (result.tasks ?? []).filter((t) => t.title?.trim());
          if (tasks.length === 0) return { error: "No actionable task found in the note." };
          title = tasks[0].title;
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Task extraction failed" };
        }
      }

      const priority = ["LOW", "MEDIUM", "HIGH"].includes(String(args.priority ?? ""))
        ? (String(args.priority) as "LOW" | "MEDIUM" | "HIGH")
        : "MEDIUM";
      const dueDate = args.dueDate ? new Date(String(args.dueDate)) : null;
      if (dueDate && isNaN(dueDate.getTime())) {
        return { error: "Invalid dueDate" };
      }

      const task = await prisma.task.create({
        data: {
          userId,
          title: title.slice(0, 200),
          description: `From note: "${note.title}" (noteId: ${note.id})`,
          priority,
          dueDate,
          workspaceId: await resolveDefaultTaskWorkspace(userId),
        },
      });

      return {
        action: "open_app",
        appId: "tasks",
        title: "Tasks",
        taskId: task.id,
        task: { id: task.id, title: task.title },
        note: { id: note.id, title: note.title },
        created: true,
      };
    },
  },
  {
    name: "create_tasks_from_note",
    description:
      "Read a note and extract multiple actionable tasks from it (assignments, deadlines, to-dos), create them all in the Tasks app, and open it. Use list_notes first to get the note id.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "noteId", type: "string", description: "Note id to extract tasks from", required: true },
      { name: "maxTasks", type: "number", description: "Max tasks to extract (1-20, default 10)" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      const note = await prisma.note.findFirst({ where: { id: String(args.noteId), userId } });
      if (!note) return { error: "Note not found" };

      let result;
      try {
        result = await generateJson<{ tasks: SyllabusTaskSpec[] }>(
          model,
          syllabusTasksPrompt(note.content),
          syllabusTasksSchemaHint()
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Task extraction failed" };
      }

      const max = Math.max(1, Math.min(20, Number(args.maxTasks) || 10));
      const tasks = (result.tasks ?? []).filter((t) => t.title?.trim()).slice(0, max);
      if (tasks.length === 0) return { error: "No tasks found in the note." };

      let created = 0;
      const workspaceId = await resolveDefaultTaskWorkspace(userId);
      for (const t of tasks) {
        const priority = ["LOW", "MEDIUM", "HIGH"].includes(t.priority ?? "")
          ? (t.priority as "LOW" | "MEDIUM" | "HIGH")
          : "MEDIUM";
        let dueDate: Date | null = null;
        if (t.dueDate) {
          const parsed = new Date(t.dueDate);
          if (!isNaN(parsed.getTime())) dueDate = parsed;
        }
        await prisma.task.create({
          data: {
            userId,
            title: String(t.title).slice(0, 200),
            priority,
            dueDate,
            description: `From note: "${note.title}" (noteId: ${note.id})`,
            workspaceId,
          },
        });
        created++;
      }

      return {
        action: "open_app",
        appId: "tasks",
        title: "Tasks",
        created,
        taskCount: tasks.length,
        note: { id: note.id, title: note.title },
      };
    },
  },
  {
    name: "create_note_from_task",
    description:
      "Create a new note seeded from a task's title and description (as a markdown template with a checkbox body), then open it in the Notes app. Useful when the user wants to expand a task into detailed notes. Use list_tasks first to get the task id.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "taskId", type: "string", description: "Task id to create a note from", required: true },
      { name: "expand", type: "boolean", description: "If true, use the LLM to expand the task into detailed notes (default false = template only)" },
    ],
    handler: async (args, { userId }) => {
      const task = await prisma.task.findUnique({ where: { id: String(args.taskId), userId } });
      if (!task) return { error: "Task not found" };

      let content: string;
      if (args.expand) {
        const cfg = await getUserConfig(userId);
        if (!cfg.apiKey) return { error: "No AI provider configured for expansion." };
        const { model } = await acquireLlmModel(userId);
        try {
          content = await generateText(
            model,
            `Expand the following task into detailed, useful notes in Markdown. Include relevant context, steps, and considerations. Do not invent unrelated information.\n\nTask: ${task.title}\nDescription: ${task.description || "(none)"}`,
            "You are a study assistant. Write clear, useful notes in Markdown."
          );
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Expansion failed" };
        }
      } else {
        content = `# ${task.title}\n\n**Priority:** ${task.priority}\n${task.dueDate ? `**Due:** ${new Date(task.dueDate).toLocaleDateString()}\n` : ""}\n## Details\n\n${task.description || "(Add details here)"}\n\n## Checklist\n\n- [ ] \n- [ ] \n- [ ] \n`;
      }

      const title = `Notes: ${task.title}`.slice(0, 200);
      const note = await prisma.note.create({
        data: { userId, title, content, tags: "task,ai" },
      });

      return {
        action: "open_app",
        appId: "notes",
        title,
        noteId: note.id,
        note: { id: note.id, title: note.title },
        task: { id: task.id, title: task.title },
        created: true,
      };
    },
  },
  {
    name: "schedule_note_review",
    description:
      "Schedule a calendar event to review a specific note at a given time. Creates a CalendarEvent linked to the note and opens the Calendar app. Use list_notes first to get the note id.",
    destructive: true,
    clientAction: true,
    paidOnly: true, // Creates a Calendar event (Calendar is a Paid-tier app).
    parameters: [
      { name: "noteId", type: "string", description: "Note id to review", required: true },
      { name: "start", type: "string", description: "ISO 8601 datetime for the review start", required: true },
      { name: "durationMinutes", type: "number", description: "Review duration in minutes (default 30)" },
    ],
    handler: async (args, { userId }) => {
      const note = await prisma.note.findFirst({ where: { id: String(args.noteId), userId } });
      if (!note) return { error: "Note not found" };

      const start = new Date(String(args.start));
      if (isNaN(start.getTime())) return { error: "Invalid start datetime" };
      const minutes = Math.max(5, Math.min(480, Number(args.durationMinutes) || 30));
      const end = new Date(start.getTime() + minutes * 60_000);

      const event = await prisma.calendarEvent.create({
        data: {
          userId,
          title: `Review: ${note.title}`,
          description: `Review note: "${note.title}"\n\nNote id: ${note.id}`,
          start,
          end,
          source: "note",
          sourceRef: note.id,
          color: "#8b5cf6",
        },
      });

      return {
        action: "open_calendar",
        date: start.toISOString(),
        event: { id: event.id, title: event.title },
        note: { id: note.id, title: note.title },
        created: true,
      };
    },
  },
];
