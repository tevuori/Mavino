// ===== Athena tools: Crunch (Pro-tier AI exam planner) =====
// Lets Athena query the user's adaptive exam-prep plan — check status, list
// what's due today, see behind alerts, and open the Crunch app.

import type { ToolDef } from "./plugin";
import { getCrunchStatus, logProgress, checkBehindAlert, ensureChapterSession, ensureMockSession } from "../../crunch";
import { isStudyFunctionEnabled } from "../../study-functions";
import { acquireLlmModel } from "../llm";

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
        exams: d.exams.map((e) => ({
          name: e.name,
          date: e.date,
          materials: e.sourceIds?.length ?? 0,
          pastExams: e.pastExamSourceIds?.length ?? 0,
          hasMockSession: Boolean(e.mockSessionId),
          chapters: d.topics
            .filter((t) => t.examId === e.id)
            .map((t) => ({
              label: t.label,
              mastery: t.mastery,
              priority: t.priority,
              progress: t.chapterProgress?.status ?? "not_started",
              covered: t.chapterProgress?.covered ?? 0,
              total: t.chapterProgress?.total ?? 0,
            })),
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
    name: "crunch_teach",
    description:
      "Start (or resume) a Teach Me session for a Crunch chapter, or run the exam's mock exam. Use this when the user asks to be taught a chapter/topic from their Crunch exam plan, or wants to do a mock/practice exam. Returns the session as an open_teach client action — the Teach Me app opens on it automatically.",
    clientAction: true,
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "exam", type: "string", description: "Exam name (or a distinctive part of it) from crunch_status", required: true },
      { name: "chapter", type: "string", description: "Chapter/topic label to teach. Omit when mock=true." },
      { name: "mock", type: "boolean", description: "true = run the mock exam (examiner mode on past papers) instead of a chapter session" },
    ],
    handler: async (args, { userId }) => {
      if (!(await isStudyFunctionEnabled(userId, "teach"))) {
        return { error: "Teach Me is disabled for this user's tier." };
      }
      const status = await getCrunchStatus(userId);
      if (!status || status.status !== "ready" || !status.data) {
        return { error: "No Crunch plan yet. Ask the user to set up their exams in the Crunch app first." };
      }
      const d = status.data;
      const examQuery = String(args.exam ?? "").trim().toLowerCase();
      const exam = d.exams.find((e) => e.name.toLowerCase() === examQuery)
        ?? d.exams.find((e) => e.name.toLowerCase().includes(examQuery))
        ?? d.exams.find((e) => examQuery.includes(e.name.toLowerCase()));
      if (!exam) {
        return { error: `No exam matching "${args.exam}". Available: ${d.exams.map((e) => e.name).join(", ")}` };
      }

      const mock = args.mock === true;
      if (mock) {
        const { model } = await acquireLlmModel(userId, { feature: "athena.tools" });
        const result = await ensureMockSession(userId, model, exam.id);
        if (!result.ok) return { error: result.error };
        return { sessionId: result.sessionId, title: result.title, action: "open_teach" };
      }

      const chapterQuery = String(args.chapter ?? "").trim().toLowerCase();
      if (!chapterQuery) return { error: "Provide a chapter to teach (or set mock=true for a mock exam)." };
      const chapters = d.topics.filter((t) => t.examId === exam.id);
      const topic = chapters.find((t) => t.label.toLowerCase() === chapterQuery)
        ?? chapters.find((t) => t.label.toLowerCase().includes(chapterQuery))
        ?? chapters.find((t) => chapterQuery.includes(t.label.toLowerCase()));
      if (!topic) {
        return { error: `No chapter matching "${args.chapter}" in "${exam.name}". Chapters: ${chapters.map((t) => t.label).join(", ")}` };
      }
      const { model } = await acquireLlmModel(userId, { feature: "athena.tools" });
      const result = await ensureChapterSession(userId, model, topic.id);
      if (!result.ok) return { error: result.error };
      return { sessionId: result.sessionId, title: result.title, action: "open_teach" };
    },
  },
  {
    name: "open_crunch",
    description:
      "Open the Crunch app on the user's desktop, optionally focused on a specific date or exam. Use after answering an exam-prep question so the user can see their full day-by-day plan and chapter progress.",
    clientAction: true,
    proOnly: true,
    parameters: [
      { name: "date", type: "string", description: "Optional date to focus on (YYYY-MM-DD)" },
      { name: "examId", type: "string", description: "Optional exam id — expands the chapters panel for that exam" },
    ],
    handler: async (args) => ({
      action: "open_crunch",
      date: args.date ? String(args.date) : undefined,
      examId: args.examId ? String(args.examId) : undefined,
    }),
  },
];
