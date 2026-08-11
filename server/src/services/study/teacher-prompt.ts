// ===== Interactive Teacher system prompt =====
// Builds the system prompt for the "Teach Me" mode. It grounds Athena in the
// session's StudySources (reusing the [n] citation convention from
// groundedQaSystemPrompt) AND instructs her on how to use the show_source /
// highlight / scroll / comprehension tools to conduct a live, show-and-tell
// tutoring session.
//
// The source-history (ordered list of sources shown so far) is injected so
// Athena can resolve references like "go back to the first file" or "the
// second paragraph" without a separate NL-parsing module.
//
// The session state also carries the lesson plan, the per-concept mastery map,
// unresolved misconceptions and source-display failures, so the tutor can pace
// itself, re-teach weak concepts and degrade gracefully when a visual aid
// cannot be shown. All state fields are optional and parsed defensively — old
// sessions keep working.

import { budgetSources, type GroundedSource, langInstr, type StudyLanguage } from "./prompts";

/** An entry in the ordered source-history shown during a session. */
export interface SourceHistoryEntry {
  /** Window id the source was opened in (so Athena can focus/close it). */
  windowId: string;
  /** 1-based source index (matches the SOURCE [n] label). */
  index: number;
  name: string;
  kind: string;
  refId: string;
  /** The last highlight text applied (if any). */
  lastHighlight?: string;
}

/** A single comprehension-check outcome. */
export interface ComprehensionEntry {
  concept: string;
  passed: boolean;
  /** Short feedback shown to the student (from the assessor). */
  feedback?: string;
  /** What the student got wrong, if anything. */
  misconception?: string;
  question?: string;
  answer?: string;
  at?: string;
}

/** Per-concept mastery accounting, updated from assessment results. */
export interface MasteryEntry {
  checksTotal: number;
  checksPassed: number;
  lastAskedAt?: string;
  /** Last known misconception for this concept (cleared on a pass). */
  misconception?: string;
}

export interface LessonPlanCheck {
  concept: string;
  question: string;
}

export interface LessonPlan {
  title: string;
  objectives: string[];
  keyConcepts: string[];
  checks?: LessonPlanCheck[];
  estimatedTurns?: number;
  /** 1-based source indices suggested as a starting point. */
  suggestedSources?: number[];
}

export type TeachingStyle = "explain" | "socratic";

/** A source that could not be displayed on the student's screen. */
export interface SourceIssue {
  name?: string;
  refId?: string;
  /** "blocked-by-cors" | "file-not-found" | "unsupported-type" | "no-match" | … */
  reason: string;
  at?: string;
}

export interface TeacherSessionState {
  /** The student's self-assessed level: "beginner" | "intermediate" | "advanced". */
  studentLevel?: string;
  /** Ordered list of sources shown during the session (for reference resolution). */
  sourceHistory?: SourceHistoryEntry[];
  /** Concepts already covered in this session (for pacing / recap). */
  coveredConcepts?: string[];
  /** Comprehension check outcomes. */
  comprehensionLog?: ComprehensionEntry[];
  /** Generated agenda for the session. */
  lessonPlan?: LessonPlan;
  /** Per-concept mastery map, keyed by concept. */
  mastery?: Record<string, MasteryEntry>;
  /** "explain" (default) or "socratic". */
  teachingStyle?: TeachingStyle;
  /** Level inferred from comprehension performance (never lower than studentLevel). */
  inferredLevel?: string;
  /** Whether the tutor should stick to the lesson plan (default true). */
  followPlan?: boolean;
  /** Source-display failures reported by the client. */
  sourceIssues?: SourceIssue[];
  /** Student pace feedback: "too_easy" | "just_right" | "too_hard". */
  paceFeedback?: string;
  /** Set once the tutor has wrapped the lesson up. */
  lessonCompletedAt?: string;
}

const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type StudentLevel = (typeof LEVELS)[number];

function levelIndex(level: string | undefined): number {
  const i = LEVELS.indexOf((level ?? "intermediate") as StudentLevel);
  return i < 0 ? 1 : i;
}

/** Pass rate for a concept (0..1). Unasked concepts return 0. */
export function passRate(entry: MasteryEntry | undefined): number {
  if (!entry || entry.checksTotal <= 0) return 0;
  return entry.checksPassed / entry.checksTotal;
}

export interface MasteryBuckets {
  /** Plan concepts that have never been checked. */
  toCover: string[];
  /** Checked concepts below a 60% pass rate. */
  needingReview: string[];
  /** Concepts at or above an 80% pass rate. */
  mastered: string[];
}

/** Split the lesson's concepts into to-cover / needs-review / mastered buckets. */
export function masteryBuckets(state: TeacherSessionState): MasteryBuckets {
  const mastery = state.mastery ?? {};
  const planConcepts = state.lessonPlan?.keyConcepts ?? [];
  const covered = new Set(state.coveredConcepts ?? []);
  const known = new Set([...planConcepts, ...Object.keys(mastery), ...covered]);

  const toCover: string[] = [];
  const needingReview: string[] = [];
  const mastered: string[] = [];

  for (const concept of known) {
    const entry = mastery[concept];
    if (!entry || entry.checksTotal === 0) {
      if (!covered.has(concept)) toCover.push(concept);
      continue;
    }
    const rate = passRate(entry);
    if (rate >= 0.8) mastered.push(concept);
    else if (rate < 0.6) needingReview.push(concept);
  }
  return { toCover, needingReview, mastered };
}

/** Fold one assessment result into the session state (pure — returns a copy). */
export function applyAssessmentToState(
  state: TeacherSessionState,
  result: {
    concept: string;
    passed: boolean;
    feedback?: string;
    misconception?: string;
    question?: string;
    answer?: string;
  }
): TeacherSessionState {
  const concept = result.concept.trim();
  if (!concept) return state;
  const at = new Date().toISOString();

  const prev = state.mastery?.[concept];
  const entry: MasteryEntry = {
    checksTotal: (prev?.checksTotal ?? 0) + 1,
    checksPassed: (prev?.checksPassed ?? 0) + (result.passed ? 1 : 0),
    lastAskedAt: at,
    misconception: result.passed ? undefined : result.misconception || prev?.misconception,
  };

  const log: ComprehensionEntry[] = [
    ...(state.comprehensionLog ?? []),
    {
      concept,
      passed: result.passed,
      feedback: result.feedback,
      misconception: result.misconception,
      question: result.question,
      answer: result.answer,
      at,
    },
  ];

  const covered = state.coveredConcepts ?? [];
  const next: TeacherSessionState = {
    ...state,
    coveredConcepts: covered.includes(concept) ? covered : [...covered, concept],
    comprehensionLog: log.slice(-60),
    mastery: { ...(state.mastery ?? {}), [concept]: entry },
  };
  next.inferredLevel = inferAdaptiveLevel(next);
  return next;
}

/** Mark a concept as introduced (without an assessment). */
export function markConceptCovered(state: TeacherSessionState, concept: string): TeacherSessionState {
  const c = concept.trim();
  if (!c) return state;
  const covered = state.coveredConcepts ?? [];
  if (covered.includes(c)) return state;
  return { ...state, coveredConcepts: [...covered, c] };
}

/**
 * Infer the level to teach at from comprehension performance and explicit pace
 * feedback. `studentLevel` acts as a floor so the student stays in control:
 * we only ever teach at or above the level they picked, but we can move up when
 * they are clearly coasting.
 */
export function inferAdaptiveLevel(state: TeacherSessionState): string {
  const floor = levelIndex(state.studentLevel);
  const log = state.comprehensionLog ?? [];
  const recent = log.slice(-6);
  let idx = floor;
  if (recent.length >= 3) {
    const rate = recent.filter((c) => c.passed).length / recent.length;
    if (rate >= 0.85) idx = Math.min(LEVELS.length - 1, floor + 1);
    else if (rate < 0.5) idx = floor; // stay at the floor, prompt asks for simpler wording
  }
  if (state.paceFeedback === "too_easy") idx = Math.min(LEVELS.length - 1, idx + 1);
  if (state.paceFeedback === "too_hard") idx = floor;
  return LEVELS[idx];
}

/**
 * Concepts worth reviewing when no check has failed yet: everything covered
 * that is not demonstrably mastered. Used by the export endpoints so a lesson
 * without failed checks still produces useful review material.
 */
export function weakConceptsFallback(state: TeacherSessionState): string[] {
  const mastered = new Set(masteryBuckets(state).mastered);
  return (state.coveredConcepts ?? []).filter((c) => !mastered.has(c));
}

/** Concepts with an open (unresolved) misconception. */
export function openMisconceptions(state: TeacherSessionState): { concept: string; misconception: string }[] {
  const out: { concept: string; misconception: string }[] = [];
  for (const [concept, entry] of Object.entries(state.mastery ?? {})) {
    if (entry.misconception && passRate(entry) < 0.8) {
      out.push({ concept, misconception: entry.misconception });
    }
  }
  return out;
}

function bullets(items: string[], empty = "  (none)"): string {
  return items.length ? items.map((i) => `  - ${i}`).join("\n") : empty;
}

const STYLE_INSTRUCTIONS: Record<TeachingStyle, string> = {
  explain:
    "TEACHING MODE — EXPLAIN (default):\n" +
    "- Explain the concept clearly first, then check understanding with check_comprehension.\n" +
    "- Use concrete examples and analogies before formal definitions.",
  socratic:
    "TEACHING MODE — SOCRATIC:\n" +
    "- Do NOT hand over the answer. Lead with a short, focused question that moves the student one step forward.\n" +
    "- Ask ONE question at a time and wait for the answer. Acknowledge partial progress explicitly before probing further.\n" +
    "- Only state the full answer after the student has arrived at it, or after they explicitly ask you to reveal it.\n" +
    "- Keep each turn short: at most a sentence or two of scaffolding plus the question.",
};

export function teacherSystemPrompt(
  sources: GroundedSource[],
  history: SourceHistoryEntry[],
  state: TeacherSessionState,
  lang?: StudyLanguage
): string {
  const budgeted = budgetSources(sources, 40000);
  const blocks = budgeted
    .map((s) => `--- SOURCE [${s.index}] (${s.kind}: ${s.name}) id=${s.refId} kind=${s.kind} ---\n${s.text}\n`)
    .join("\n");

  const historyLines = history.length
    ? history
        .map(
          (h) =>
            `  - window ${h.windowId}: SOURCE [${h.index}] "${h.name}" (${h.kind})${
              h.lastHighlight ? ` — last highlighted: "${h.lastHighlight.slice(0, 80)}"` : ""
            }`
        )
        .join("\n")
    : "  (none yet)";

  const covered = bullets(state.coveredConcepts ?? [], "  (none yet)");

  const compLog = state.comprehensionLog?.length
    ? state.comprehensionLog
        .slice(-12)
        .map(
          (c) =>
            `  - ${c.concept}: ${c.passed ? "understood" : "needs review"}${
              c.misconception ? ` — misconception: ${c.misconception}` : ""
            }`
        )
        .join("\n")
    : "  (no checks yet)";

  const style: TeachingStyle = state.teachingStyle === "socratic" ? "socratic" : "explain";
  const buckets = masteryBuckets(state);
  const adaptiveLevel = state.inferredLevel ?? inferAdaptiveLevel(state);
  const misconceptions = openMisconceptions(state);

  const plan = state.lessonPlan;
  const planBlock = plan
    ? `LESSON PLAN — "${plan.title}"${state.followPlan === false ? " (student is exploring freely; use the plan only as a map)" : ""}
Objectives:
${bullets(plan.objectives ?? [])}
Key concepts (teach in this order unless the student steers elsewhere):
${bullets(plan.keyConcepts ?? [])}
${
  plan.checks?.length
    ? `Planned comprehension checks:\n${plan.checks
        .map((ch) => `  - [${ch.concept}] ${ch.question}`)
        .join("\n")}\n`
    : ""
}`
    : "LESSON PLAN: (none — build the lesson from the student's request and the sources)";

  const masteryBlock = `CONCEPT MASTERY:
Not yet covered:
${bullets(buckets.toCover, "  (nothing pending)")}
Needs review (below 60% pass rate — re-teach these differently before moving on):
${bullets(buckets.needingReview, "  (none)")}
Mastered (≥80% — do not re-explain unless asked):
${bullets(buckets.mastered, "  (none)")}`;

  const misconceptionBlock = misconceptions.length
    ? `OPEN MISCONCEPTIONS (address these before advancing):
${misconceptions.map((m) => `  - ${m.concept}: ${m.misconception}`).join("\n")}`
    : "";

  const issues = (state.sourceIssues ?? []).slice(-5);
  const issueBlock = issues.length
    ? `SOURCE DISPLAY PROBLEMS (the student could NOT see these — quote the passage inline in your reply instead of relying on the visual):
${issues.map((i) => `  - ${i.name ?? i.refId ?? "source"}: ${i.reason}`).join("\n")}`
    : "";

  const paceBlock =
    state.paceFeedback === "too_hard"
      ? "PACE: the student said this is TOO HARD. Slow down, use smaller steps and simpler wording."
      : state.paceFeedback === "too_easy"
        ? "PACE: the student said this is TOO EASY. Move faster, skip basics and go deeper."
        : "";

  return `You are Mavino, an interactive tutor inside the Mavino Student OS. You are conducting a LIVE, real-time teaching session with the student. Your goal is to make the material as easy to understand as possible, adapting to the student's level.

TEACHING STYLE:
- Speak conversationally, as a patient, encouraging tutor. Keep explanations clear and concrete.
- Use the student's own sources (provided below) as the basis for your teaching. Cite them inline with [n] markers like in a study chat.
- The student picked level: ${state.studentLevel ?? "intermediate"}. Based on how they are doing, teach at: ${adaptiveLevel}. If they seem confused, simplify and use analogies. If they're coasting, go deeper.
- Break complex topics into steps. Check in frequently rather than lecturing for too long.

${STYLE_INSTRUCTIONS[style]}

CRITICAL: The full text of all sources is ALREADY in your context (see SOURCES below). You do NOT need to "look at" or "search" the materials — you already have them. Do NOT say things like "let me check the materials" or "let me look at the sources". Instead, teach directly from what you already know from the sources, and use show_source only as a visual aid to show the student the specific passage you're discussing.

SHOW & TELL (the core of this mode):
- Call show_source to open a source and visually display a passage to the student WHILE you are teaching it. This is a visual aid, not a search step.
- To open a source, pass kind and refId from the SOURCE label above (e.g. kind="file" refId="<the id from the source label>"). Do NOT pass sourceId as a number — use kind+refId from the source labels.
- For highlightText, pass a DISTINCTIVE phrase (roughly 8-50 chars) from the passage you are discussing. The matcher is fuzzy, so you do NOT need to copy it perfectly — but the phrase MUST contain rare, specific words from the passage so it lands on the RIGHT passage and not a common word elsewhere.
  GOOD: "mitochondria are the powerhouse of the cell", "gradient descent minimizes a loss function", "the Krebs cycle occurs in the mitochondrial matrix".
  BAD: "the", "this", "as mentioned above", "the source says", a single common word, or a long paragraph (it over-highlights). A vague phrase highlights the wrong spot or nothing.
- For code files, use highlightLine/highlightLineEnd (1-based line numbers) to highlight specific lines instead of highlightText.
- Call show_source for EACH new passage you discuss, right before the sentence that references it, so the source scrolls to the passage as you speak.
- Switch between sources naturally. When referring back to a previously shown source, use focus_source with its windowId (from the source history below) instead of re-opening it.
- When you're done with a source, call close_source to keep the workspace clean.
- Call clear_highlight before highlighting a new passage in the same window.
- If a tool reports that a highlight or a source could not be shown, do not pretend the student can see it — quote the passage inline in your reply instead.

CRITICAL: After calling any tool (show_source, highlight_source, etc.), you MUST continue your explanation. Do NOT stop after a tool call. The tool call is a visual aid that happens DURING your explanation, not a replacement for it. Always provide a complete, substantive explanation of the topic — never just an intro followed by a tool call with no continuation.

LESSON FLOW:
- Work objective by objective: introduce the concept, ground it in the source, then verify with a comprehension check.
- Call mark_concept_covered as soon as you have finished explaining a concept, so the agenda stays in sync.
- When every objective is covered (or the student asks to wrap up), call finish_lesson with a recap and the concepts that still need work.

COMPREHENSION CHECKS:
- After explaining a key concept, call check_comprehension with ONE short question and the expectedConcept it tests. The answer is graded automatically and comes back to you with the verdict.
- Prefer an open question; pass 2-4 options only when a multiple-choice question genuinely tests understanding.
- Never ask a check about a concept you have not taught yet in this session.
- When a check comes back as failed, re-explain that concept differently (simpler wording, another analogy, another source) BEFORE moving on, and address the misconception explicitly.

CITATION RULES:
- Every factual statement drawn from a source MUST be followed by an inline [n] citation matching the SOURCE labels below.
- Do NOT invent facts not in the sources. If the sources lack something, say so.
- You MAY use general pedagogical knowledge (analogies, explanations of universal concepts) without a citation, but any claim about the specific source material must be cited.

${planBlock}

${masteryBlock}
${misconceptionBlock ? `\n${misconceptionBlock}\n` : ""}${issueBlock ? `\n${issueBlock}\n` : ""}${paceBlock ? `\n${paceBlock}\n` : ""}
SOURCE HISTORY (sources shown so far this session, in order):
${historyLines}

CONCEPTS COVERED:
${covered}

COMPREHENSION LOG:
${compLog}

SOURCES:
${blocks}
${langInstr(lang)}`;
}
