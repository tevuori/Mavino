// ===== Athena tools: Crunch (Pro-tier AI exam planner) =====
// Lets Athena query the user's adaptive exam-prep plan — check status, list
// what's due today, see behind alerts, and open the Crunch app.

import type { ToolDef } from "./plugin";
import { getCrunchStatus, logProgress, checkBehindAlert } from "../../crunch";

export const crunchTools: ToolDef[] = [
  {
    name: "crunch_status",
    description:
      "Check the status of the user's Crunch exam-prep plan — whether it's generated, how many exams/topics/days it has, how many minutes completed vs total, the behind percentage, and the next upcoming exam. Returns null if Crunch hasn't been set up yet. Use this before answering questions about exam prep or study scheduling.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const status = await getCrunchStatus(userId);
      if (!status || status.status !== "ready" || !status.data) {
        return { built: false, status: status?.status ?? "empty" };
      }
      const d = status.data;
      // Fire-and-forget behind-alert check.
      void checkBehindAlert(userId).catch(() => {});
      return {
        built: true,
        status: status.status,
        updatedAt: status.updatedAt,
        stats: d.stats,
        exams: d.exams.map((e) => ({ name: e.name, date: e.date })),
        topics: d.topics.slice(0, 15).map((t) => ({
          label: t.label,
          mastery: t.mastery,
          priority: t.priority,
          examName: d.exams.find((e) => e.id === t.examId)?.name ?? "Unknown",
        })),
      };
    },
  },
  {
    name: "crunch_today",
    description:
      "List today's study tasks from the user's Crunch exam-prep plan — each task with its topic, type (new/review/practice/mock), duration, and done status. Use this when the user asks what to study today or what's on their exam prep schedule.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const status = await getCrunchStatus(userId);
      if (!status || status.status !== "ready" || !status.data) {
        return { error: "Crunch plan hasn't been generated yet. Ask the user to open the Crunch app and set up their exams." };
      }
      const todayStr = new Date().toISOString().slice(0, 10);
      const today = status.data.days.find((d) => d.date === todayStr);
      if (!today || today.tasks.length === 0) {
        return { date: todayStr, tasks: [], note: "No tasks scheduled for today." };
      }
      return {
        date: todayStr,
        totalMinutes: today.totalMinutes,
        completedMinutes: today.completedMinutes,
        tasks: today.tasks.map((t) => {
          const topic = status.data!.topics.find((tp) => tp.id === t.topicId);
          const exam = status.data!.exams.find((e) => e.id === t.examId);
          return {
            id: t.id,
            topic: topic?.label ?? "Exam day",
            exam: exam?.name ?? "Unknown",
            type: t.type,
            duration: t.duration,
            done: t.done,
          };
        }),
      };
    },
  },
  {
    name: "crunch_log_progress",
    description:
      "Mark a Crunch study task as done or not-done by its task id (from crunch_today). Use this when the user says they completed a study task. Returns the updated plan stats.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "taskId", type: "string", description: "The task id from crunch_today", required: true },
      { name: "done", type: "boolean", description: "true = mark complete, false = mark incomplete", required: true },
    ],
    handler: async (args, { userId }) => {
      const taskId = String(args.taskId ?? "").trim();
      if (!taskId) return { error: "taskId is required" };
      const done = args.done !== false; // default true
      const data = await logProgress(userId, { taskId, done });
      if (!data) return { error: "Task not found or Crunch plan not ready" };
      return {
        ok: true,
        stats: data.stats,
      };
    },
  },
  {
    name: "open_crunch",
    description:
      "Open the Crunch app on the user's desktop, optionally focused on a specific date. Use after answering an exam-prep question so the user can see their full day-by-day plan.",
    clientAction: true,
    proOnly: true,
    parameters: [
      { name: "date", type: "string", description: "Optional date to focus on (YYYY-MM-DD)" },
    ],
    handler: async (args) => ({ action: "open_crunch", date: args.date ? String(args.date) : undefined }),
  },
];
