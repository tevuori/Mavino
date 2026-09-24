import { describe, expect, it } from "bun:test";
import {
  announcedUndeliveredCheck,
  applyAssessmentToState,
  inferAdaptiveLevel,
  masteryBuckets,
  openMisconceptions,
  passRate,
  teacherSystemPrompt,
  weakConceptsFallback,
  type TeacherSessionState,
} from "./teacher-prompt";

describe("teacher-prompt mastery helpers", () => {
  it("returns zero for an unasked concept and the correct ratio otherwise", () => {
    expect(passRate(undefined)).toBe(0);
    expect(passRate({ checksTotal: 0, checksPassed: 0 })).toBe(0);
    expect(passRate({ checksTotal: 5, checksPassed: 3 })).toBe(0.6);
  });

  it("places concepts into the implementation's mastery buckets", () => {
    const state: TeacherSessionState = {
      lessonPlan: { title: "Basics", objectives: [], keyConcepts: ["new", "weak", "borderline", "mastered"] },
      mastery: {
        weak: { checksTotal: 5, checksPassed: 2 },
        borderline: { checksTotal: 5, checksPassed: 3 },
        mastered: { checksTotal: 5, checksPassed: 4 },
      },
    };

    expect(masteryBuckets(state)).toEqual({
      toCover: ["new"],
      needingReview: ["weak"],
      mastered: ["mastered"],
    });
  });

  it("applies failing and passing assessments immutably", () => {
    const initial: TeacherSessionState = {
      mastery: { algebra: { checksTotal: 1, checksPassed: 1 } },
      comprehensionLog: [],
      coveredConcepts: [],
    };

    const failed = applyAssessmentToState(initial, {
      concept: "algebra",
      passed: false,
      feedback: "Try again",
      misconception: "Confused variables with constants",
    });
    expect(initial).toEqual({
      mastery: { algebra: { checksTotal: 1, checksPassed: 1 } },
      comprehensionLog: [],
      coveredConcepts: [],
    });
    expect(failed.mastery?.algebra).toMatchObject({
      checksTotal: 2,
      checksPassed: 1,
      misconception: "Confused variables with constants",
    });
    expect(failed.comprehensionLog).toHaveLength(1);
    expect(failed.comprehensionLog?.[0]).toMatchObject({
      concept: "algebra",
      passed: false,
      misconception: "Confused variables with constants",
    });

    const passed = applyAssessmentToState(failed, {
      concept: "algebra",
      passed: true,
      feedback: "Correct",
    });
    expect(passed.mastery?.algebra).toMatchObject({ checksTotal: 3, checksPassed: 2 });
    expect(passed.mastery?.algebra?.misconception).toBeUndefined();
    expect(passed.comprehensionLog?.[1]).toMatchObject({
      concept: "algebra",
      passed: true,
    });
  });

  it("never infers below the explicit student level floor", () => {
    const advanced: TeacherSessionState = {
      studentLevel: "advanced",
      comprehensionLog: [
        { concept: "x", passed: false },
        { concept: "x", passed: false },
        { concept: "x", passed: false },
      ],
    };
    expect(inferAdaptiveLevel(advanced)).toBe("advanced");

    const beginnerCoasting: TeacherSessionState = {
      studentLevel: "beginner",
      comprehensionLog: [
        { concept: "x", passed: true },
        { concept: "x", passed: true },
        { concept: "x", passed: true },
      ],
    };
    expect(inferAdaptiveLevel(beginnerCoasting)).toBe("intermediate");
  });

  it("extracts weak covered concepts and open misconceptions", () => {
    const state: TeacherSessionState = {
      coveredConcepts: ["weak", "mastered", "unchecked"],
      mastery: {
        weak: { checksTotal: 2, checksPassed: 0, misconception: "Reversed the relationship" },
        mastered: { checksTotal: 5, checksPassed: 5, misconception: "Old mistake" },
        unchecked: { checksTotal: 0, checksPassed: 0 },
      },
    };

    expect(weakConceptsFallback(state)).toEqual(["weak", "unchecked"]);
    expect(openMisconceptions(state)).toEqual([
      { concept: "weak", misconception: "Reversed the relationship" },
    ]);
  });
});

describe("announcedUndeliveredCheck", () => {
  const lecture =
    "Překladač čte zdrojový program a překládá ho na cílový program. " +
    "Zdrojový a cílový program jsou vzájemně funkčně ekvivalentní — pro stejný vstup dají stejný výsledek. " +
    "Překladač mění jen formu programu, ne jeho chování, na rozdíl od interpretu, který zdroják vykonává řádek po řádku. ";

  it("detects a Czech check announcement", () => {
    expect(announcedUndeliveredCheck(`${lecture}Teď si to ověřím:`)).toBe(true);
    expect(announcedUndeliveredCheck(`${lecture}Teď si to ověřím: Napiš mi svou odpověď. 🙂`)).toBe(true);
    expect(announcedUndeliveredCheck(`${lecture}Otázka je na cestě — měla by se ti zobrazit jako interaktivní karta.`)).toBe(true);
    expect(announcedUndeliveredCheck(`${lecture}Tentokrát přes ověřovací kartu:`)).toBe(true);
  });

  it("detects English check announcements", () => {
    expect(announcedUndeliveredCheck(`${lecture}Let me check your understanding:`)).toBe(true);
    expect(announcedUndeliveredCheck(`${lecture}Quick check — answer in the card below.`)).toBe(true);
  });

  it("detects a teaching turn that ends eliciting an answer (explain mode)", () => {
    expect(announcedUndeliveredCheck(`${lecture}Co je vstupem a výstupem překladače?`)).toBe(true);
    expect(announcedUndeliveredCheck(`${lecture}Napiš mi svou odpověď`)).toBe(true);
    expect(announcedUndeliveredCheck(`${lecture}Write your answer in your own words 🙂`)).toBe(true);
  });

  it("does not fire for plain explanations", () => {
    expect(announcedUndeliveredCheck(lecture)).toBe(false);
    expect(announcedUndeliveredCheck(`${lecture}Zbytek máš dobře. 👍 Jdeme dál.`)).toBe(false);
    expect(announcedUndeliveredCheck("")).toBe(false);
  });

  it("ignores short conversational questions", () => {
    expect(announcedUndeliveredCheck("Chceš pokračovat?")).toBe(false);
  });

  it("ignores plain-text questions in socratic mode unless a card is announced", () => {
    const socratic = `${lecture}Co myslíš, že se stane dál?`;
    expect(announcedUndeliveredCheck(socratic, "socratic")).toBe(false);
    expect(announcedUndeliveredCheck(`${lecture}Teď si to ověřím:`, "socratic")).toBe(true);
  });
});

describe("teacherSystemPrompt check reminders", () => {
  const src = [{ index: 1, name: "s", kind: "paste", refId: "r", text: "text" }];

  it("requires the tool call in the same response as a check announcement", () => {
    const prompt = teacherSystemPrompt(src as any, [], {}, "en");
    expect(prompt).toContain("MUST be part of that SAME response");
  });

  it("adds a CHECK DUE reminder only after several turns without a check", () => {
    expect(teacherSystemPrompt(src as any, [], {}, "en", false, 0)).not.toContain("CHECK DUE");
    expect(teacherSystemPrompt(src as any, [], {}, "en", false, 1)).not.toContain("CHECK DUE");
    expect(teacherSystemPrompt(src as any, [], {}, "en", false, 3)).toContain("CHECK DUE");
    expect(
      teacherSystemPrompt(src as any, [], { lessonCompletedAt: "2026-01-01" }, "en", false, 5)
    ).not.toContain("CHECK DUE");
  });
});
