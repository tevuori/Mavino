import { api } from "./api";
import type { Course, Assignment } from "../types";

export const gradesApi = {
  listCourses: (semester?: string) =>
    api.get<{ courses: Course[] }>(`/api/grades/courses${semester ? `?semester=${encodeURIComponent(semester)}` : ""}`),
  createCourse: (data: { name: string; code?: string; semester?: string; credits?: number; color?: string }) =>
    api.post<{ course: Course }>("/api/grades/courses", data),
  updateCourse: (id: string, data: Partial<{ name: string; code: string; semester: string; credits: number; color: string }>) =>
    api.patch<{ course: Course }>(`/api/grades/courses/${id}`, data),
  deleteCourse: (id: string) => api.delete(`/api/grades/courses/${id}`),

  createAssignment: (courseId: string, data: { name: string; score: number; maxScore?: number; weight?: number; category?: string }) =>
    api.post<{ assignment: Assignment }>(`/api/grades/courses/${courseId}/assignments`, data),
  updateAssignment: (id: string, data: Partial<{ name: string; score: number; maxScore: number; weight: number; category: string }>) =>
    api.patch<{ assignment: Assignment }>(`/api/grades/assignments/${id}`, data),
  deleteAssignment: (id: string) => api.delete(`/api/grades/assignments/${id}`),

  listSemesters: () => api.get<{ semesters: string[] }>("/api/grades/semesters"),
};

// ===== GPA computation helpers =====

/** Compute weighted percentage for a course from its assignments. */
export function coursePercentage(course: Course): number {
  if (course.assignments.length === 0) return 0;
  let totalWeighted = 0;
  let totalWeight = 0;
  for (const a of course.assignments) {
    const pct = (a.score / a.maxScore) * 100;
    totalWeighted += pct * a.weight;
    totalWeight += a.weight;
  }
  return totalWeight > 0 ? totalWeighted / totalWeight : 0;
}

/** Convert percentage to letter grade. */
export function percentageToLetter(pct: number): string {
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  if (pct >= 50) return "E";
  return "F";
}

/** Convert letter grade to GPA points (4.0 scale). */
export function letterToGpa(letter: string): number {
  const map: Record<string, number> = {
    "A": 4.0,
    "B": 3.0,
    "C": 2.0,
    "D": 1.0,
    "E": 0.5,
    "F": 0.0,
  };
  return map[letter] ?? 0;
}

/** Compute overall GPA across courses (credit-weighted). */
export function computeGPA(courses: Course[]): number {
  if (courses.length === 0) return 0;
  let totalPoints = 0;
  let totalCredits = 0;
  for (const c of courses) {
    if (c.assignments.length === 0) continue;
    const pct = coursePercentage(c);
    const letter = percentageToLetter(pct);
    const gpa = letterToGpa(letter);
    totalPoints += gpa * c.credits;
    totalCredits += c.credits;
  }
  return totalCredits > 0 ? totalPoints / totalCredits : 0;
}

/** Get a color for a percentage score. */
export function scoreColor(pct: number): string {
  if (pct >= 90) return "text-success";
  if (pct >= 80) return "text-info";
  if (pct >= 60) return "text-warning";
  return "text-danger";
}
