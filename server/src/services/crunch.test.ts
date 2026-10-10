import { describe, expect, test } from "bun:test";
import { chapterProgressFromState } from "./crunch";
import type { TeacherSessionState } from "./study/teacher-prompt";

describe("chapterProgressFromState", () => {
  test("empty state is not_started", () => {
    const p = chapterProgressFromState({});
    expect(p.status).toBe("not_started");
    expect(p.covered).toBe(0);
    expect(p.total).toBe(0);
    expect(p.passRate).toBe(-1);
  });

  test("lesson plan with partial coverage is in_progress", () => {
    const state: TeacherSessionState = {
      lessonPlan: { title: "Ch", objectives: [], keyConcepts: ["a", "b", "c"] },
      coveredConcepts: ["a"],
    };
    const p = chapterProgressFromState(state);
    expect(p.status).toBe("in_progress");
    expect(p.covered).toBe(1);
    expect(p.total).toBe(3);
  });

  test("all concepts covered is completed", () => {
    const state: TeacherSessionState = {
      lessonPlan: { title: "Ch", objectives: [], keyConcepts: ["a", "b"] },
      coveredConcepts: ["a", "B"], // case-insensitive
    };
    expect(chapterProgressFromState(state).status).toBe("completed");
  });

  test("lessonCompletedAt completes even with no plan", () => {
    const state: TeacherSessionState = { lessonCompletedAt: new Date().toISOString() };
    expect(chapterProgressFromState(state).status).toBe("completed");
  });

  test("comprehension log without covered concepts still counts as activity", () => {
    const state: TeacherSessionState = {
      comprehensionLog: [{ concept: "a", passed: true }],
    };
    expect(chapterProgressFromState(state).status).toBe("in_progress");
  });

  test("passRate averages per-concept pass rates", () => {
    const state: TeacherSessionState = {
      mastery: {
        a: { checksTotal: 4, checksPassed: 4 },
        b: { checksTotal: 4, checksPassed: 2 },
        c: { checksTotal: 0, checksPassed: 0 }, // unchecked — ignored
      },
    };
    const p = chapterProgressFromState(state);
    expect(p.passRate).toBeCloseTo((1 + 0.5) / 2);
  });
});
