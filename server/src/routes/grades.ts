import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";

const grades = new Hono();
grades.use("*", authMiddleware, appTierGate("grades"));

// ===== Courses =====
const courseSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().optional().default(""),
  semester: z.string().optional().default(""),
  credits: z.number().int().min(0).max(12).optional().default(3),
  color: z.string().optional().default("#6366f1"),
});

grades.get("/courses", async (c) => {
  const { userId } = c.get("auth");
  const semester = c.req.query("semester");
  const where: Record<string, unknown> = { userId };
  if (semester) where.semester = semester;
  const courses = await prisma.course.findMany({
    where: where as never,
    include: { assignments: true },
    orderBy: { name: "asc" },
  });
  return c.json({ courses });
});

grades.post("/courses", zValidator("json", courseSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const course = await prisma.course.create({ data: { ...body, userId } });
  return c.json({ course }, 201);
});

grades.patch("/courses/:id", zValidator("json", courseSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const course = await prisma.course.update({
    where: { id: c.req.param("id"), userId },
    data: c.req.valid("json"),
  });
  return c.json({ course });
});

grades.delete("/courses/:id", async (c) => {
  const { userId } = c.get("auth");
  await prisma.course.delete({ where: { id: c.req.param("id"), userId } });
  return c.json({ ok: true });
});

// ===== Assignments =====
const assignmentSchema = z.object({
  name: z.string().min(1).max(100),
  score: z.number().min(0),
  maxScore: z.number().min(1).optional().default(100),
  weight: z.number().min(0).optional().default(1),
  category: z.string().optional().default("General"),
});

grades.post("/courses/:id/assignments", zValidator("json", assignmentSchema), async (c) => {
  const { userId } = c.get("auth");
  const course = await prisma.course.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!course) return c.json({ error: "Course not found" }, 404);
  const assignment = await prisma.assignment.create({
    data: { ...c.req.valid("json"), courseId: course.id },
  });
  return c.json({ assignment }, 201);
});

grades.patch("/assignments/:assignmentId", zValidator("json", assignmentSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const assignmentId = c.req.param("assignmentId");
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { course: true },
  });
  if (!a || a.course.userId !== userId) return c.json({ error: "Not found" }, 404);
  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: c.req.valid("json"),
  });
  return c.json({ assignment: updated });
});

grades.delete("/assignments/:assignmentId", async (c) => {
  const { userId } = c.get("auth");
  const assignmentId = c.req.param("assignmentId");
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { course: true },
  });
  if (!a || a.course.userId !== userId) return c.json({ error: "Not found" }, 404);
  await prisma.assignment.delete({ where: { id: assignmentId } });
  return c.json({ ok: true });
});

// ===== Semesters (distinct values) =====
grades.get("/semesters", async (c) => {
  const { userId } = c.get("auth");
  const courses = await prisma.course.findMany({
    where: { userId },
    select: { semester: true },
    distinct: ["semester"],
  });
  const semesters = courses
    .map((c) => c.semester)
    .filter(Boolean)
    .sort();
  return c.json({ semesters });
});

export default grades;
