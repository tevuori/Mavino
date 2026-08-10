// ===== Athena habit tools =====
// list_habits, create_habit, log_habit, open_habits.

import { type ToolDef, paidOnly } from "./plugin";
import prisma from "../../../db/client";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Habits is a Paid-tier app — all habit tools are paid-only.
export const habitsTools: ToolDef[] = paidOnly([
  {
    name: "list_habits",
    description: "List the user's habits with their current streaks.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const habits = await prisma.habit.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });
      const today = todayKey();
      const thirtyAgo = new Date(Date.now() - 29 * 86400000)
        .toISOString()
        .slice(0, 10);
      const out = await Promise.all(
        habits.map(async (h) => {
          const logs = await prisma.habitLog.findMany({
            where: { habitId: h.id, userId, date: { gte: thirtyAgo, lte: today } },
            orderBy: { date: "asc" },
          });
          let currentStreak = 0;
          const cursor = new Date(today);
          const logDates = new Set(logs.map((l) => l.date));
          if (!logDates.has(today)) cursor.setDate(cursor.getDate() - 1);
          while (logDates.has(cursor.toISOString().slice(0, 10))) {
            currentStreak++;
            cursor.setDate(cursor.getDate() - 1);
          }
          return {
            id: h.id,
            name: h.name,
            cadence: h.cadence,
            target: h.target,
            currentStreak,
            doneToday: logDates.has(today),
          };
        })
      );
      return { count: out.length, habits: out };
    },
  },
  {
    name: "create_habit",
    description: "Create a new habit to track daily (e.g. 'review flashcards', '2h focus').",
    destructive: true,
    parameters: [
      { name: "name", type: "string", description: "Habit name", required: true },
      { name: "cadence", type: "string", description: "daily or weekly", enum: ["daily", "weekly"] },
      { name: "target", type: "number", description: "Target count per period (default 1)" },
    ],
    handler: async (args, { userId }) => {
      const habit = await prisma.habit.create({
        data: {
          userId,
          name: String(args.name ?? "").slice(0, 100),
          cadence: (args.cadence as any) ?? "daily",
          target: Number(args.target ?? 1) || 1,
        },
      });
      return { habit, created: true };
    },
  },
  {
    name: "log_habit",
    description: "Mark a habit as done for today (or a given date).",
    destructive: true,
    parameters: [
      { name: "habitId", type: "string", description: "Habit id from list_habits", required: true },
      { name: "date", type: "string", description: "YYYY-MM-DD (defaults to today)" },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.habitId);
      const date = String(args.date ?? todayKey());
      const habit = await prisma.habit.findUnique({ where: { id, userId } });
      if (!habit) return { error: "Habit not found" };
      const log = await prisma.habitLog.upsert({
        where: { habitId_date: { habitId: id, date } },
        create: { habitId: id, userId, date, value: 1 },
        update: { value: 1 },
      });
      return { log, habit: { id: habit.id, name: habit.name } };
    },
  },
  {
    name: "delete_habit",
    description: "Delete a habit and all its logs permanently.",
    destructive: true,
    parameters: [
      { name: "habitId", type: "string", description: "Habit id from list_habits", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.habitId);
      const habit = await prisma.habit.findUnique({ where: { id, userId } });
      if (!habit) return { error: "Habit not found" };
      await prisma.habit.delete({ where: { id, userId } });
      return { deleted: true, habitId: id, name: habit.name };
    },
  },
  {
    name: "open_habits",
    description: "Open the Habit Tracker app.",
    clientAction: true,
    parameters: [],
    handler: async (_args, _ctx) => {
      return { action: "open_habits" };
    },
  },
]);
