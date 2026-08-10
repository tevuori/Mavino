import { type ToolDef, paidOnly } from "./plugin";
import prisma from "../../../db/client";

// Grades is a Paid-tier app — all grade tools are paid-only.
export const gradeTools: ToolDef[] = paidOnly([
  {
    name: "list_courses",
    description:
      "List the user's courses (Grade Tracker) with credits, semester, and assignment summary. Optionally filter by semester.",
    parameters: [
      { name: "semester", type: "string", description: "e.g. 'Fall 2025'" },
    ],
    handler: async (args, { userId }) => {
      const where: Record<string, unknown> = { userId };
      if (args.semester) where.semester = args.semester;
      const courses = await prisma.course.findMany({
        where: where as never,
        include: { assignments: true },
        orderBy: { name: "asc" },
      });
      return {
        count: courses.length,
        courses: courses.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          semester: c.semester,
          credits: c.credits,
          assignmentCount: c.assignments.length,
        })),
      };
    },
  },
  {
    name: "get_course_grades",
    description:
      "Get all assignments + scores for a course, plus a computed weighted percentage and letter grade.",
    parameters: [
      { name: "courseId", type: "string", description: "Course id from list_courses", required: true },
    ],
    handler: async (args, { userId }) => {
      const course = await prisma.course.findFirst({
        where: { id: String(args.courseId), userId },
        include: { assignments: true },
      });
      if (!course) return { error: "Course not found" };
      const totalWeight = course.assignments.reduce((s, a) => s + a.weight, 0);
      const weighted = course.assignments.reduce((s, a) => s + (a.score / a.maxScore) * a.weight, 0);
      const pct = totalWeight > 0 ? (weighted / totalWeight) * 100 : 0;
      return {
        course: { id: course.id, name: course.name, code: course.code, credits: course.credits },
        percentage: Math.round(pct * 10) / 10,
        letterGrade: letterGrade(pct),
        assignments: course.assignments.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category,
          score: a.score,
          maxScore: a.maxScore,
          weight: a.weight,
        })),
      };
    },
  },
]);

function letterGrade(pct: number): string {
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  if (pct >= 50) return "E";
  return "F";
}
