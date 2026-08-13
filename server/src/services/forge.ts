// ===== Forge: AI practice problem generator service (Pro tier) =====
// Generates graded practice problems (multiple-choice, short-answer, and
// step-by-step) from sources (Moodle PDFs, notes, Atlas concepts, or free
// text). Each problem has a hidden worked solution. The student solves,
// submits, and gets line-by-step feedback. Wrong answers trigger a
// micro-explanation and a follow-up "variant" problem targeting the same
// misconception. Difficulty adapts to PulseForecast mastery signals.
//
// Integrates with:
//   - Atlas: reads weak concepts for targeting problem generation
//   - Pulse: writes at-risk entries when a student struggles with a concept
//   - Flashcards: can generate flashcards from missed problems
//   - Study Hub: reuses source text extraction

import type { LlmModel } from "multi-llm-ts";
import prisma from "../db/client";
import { generateJson } from "./study/llm-json";
import { getAtlas, type AtlasData, type AtlasConcept } from "./atlas";

// ----- types (serialized to/from JSON) -----

export interface ForgeSource {
  kind: "note" | "file" | "atlas" | "text" | "moodle";
  refId?: string;
  name: string;
  text?: string; // for "text" source
}

export interface ForgeProblemOption {
  id: string;
  text: string;
}

export interface ForgeProblemData {
  id: string;
  setId: string;
  type: "mcq" | "short_answer" | "step_by_step";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  options: ForgeProblemOption[];
  answer: string;
  solution: string;
  conceptIds: string[];
  hint: string;
  createdAt: string;
}

export interface ForgeAttemptData {
  id: string;
  problemId: string;
  setId: string;
  submitted: string;
  result: "correct" | "partial" | "incorrect";
  score: number;
  feedback: ForgeFeedback;
  variantGenerated: boolean;
  createdAt: string;
}

export interface ForgeFeedback {
  summary: string;
  steps?: { step: string; correct: boolean; explanation: string }[];
  misconception?: string;
  suggestion?: string;
}

export interface ForgeProblemSetSummary {
  id: string;
  title: string;
  format: string;
  difficulty: string;
  count: number;
  source: ForgeSource;
  conceptIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ForgeProblemSetDetail extends ForgeProblemSetSummary {
  problems: ForgeProblemData[];
}

export interface ForgeStats {
  totalSets: number;
  totalProblems: number;
  totalAttempts: number;
  avgScore: number;
  conceptsTargeted: number;
}

// ----- helpers -----

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ----- source text resolution -----

/** Resolve a ForgeSource to text that the LLM can generate problems from. */
async function resolveSourceText(userId: string, source: ForgeSource): Promise<string> {
  if (source.kind === "text") {
    return source.text ?? "";
  }
  if (source.kind === "note" && source.refId) {
    const note = await prisma.note.findFirst({
      where: { id: source.refId, userId },
      select: { title: true, content: true },
    });
    return note ? `${note.title}\n\n${note.content}` : "";
  }
  if (source.kind === "file" && source.refId) {
    const file = await prisma.vFile.findFirst({
      where: { id: source.refId, userId },
      select: { name: true, storageKey: true, mimeType: true, externalUrl: true },
    });
    if (!file) return "";
    // Reuse Compass's text extraction approach
    if (file.mimeType === "application/pdf" || file.name.endsWith(".pdf")) {
      if (file.storageKey) {
        const path = await import("node:path");
        const { readFile } = await import("node:fs/promises");
        const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
        try {
          const buf = await readFile(path.join(UPLOAD_DIR, file.storageKey));
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: new Uint8Array(buf) });
          const result = await parser.getText();
          await parser.destroy().catch(() => {});
          return result.text || "";
        } catch {
          return "";
        }
      }
    }
    // Text file
    if (file.storageKey) {
      const path = await import("node:path");
      const { readFile } = await import("node:fs/promises");
      const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
      try {
        return (await readFile(path.join(UPLOAD_DIR, file.storageKey))).toString("utf-8");
      } catch {
        return "";
      }
    }
  }
  if (source.kind === "atlas") {
    // Use Atlas concepts as the source — the LLM generates problems from
    // the concept labels + definitions.
    const atlas = await getAtlas(userId);
    if (!atlas?.data) return "";
    const concepts = atlas.data.concepts
      .map((c) => `- ${c.label} (${c.type}): ${c.definition}`)
      .join("\n");
    return `Atlas knowledge concepts:\n${concepts}`;
  }
  return "";
}

/** Get weak concepts from Atlas for adaptive targeting. */
async function getWeakAtlasConcepts(userId: string): Promise<AtlasConcept[]> {
  const atlas = await getAtlas(userId);
  if (!atlas?.data) return [];
  return atlas.data.concepts.filter((c) => c.weak);
}

// ----- problem set CRUD -----

export async function listProblemSets(userId: string): Promise<ForgeProblemSetSummary[]> {
  const sets = await prisma.forgeProblemSet.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { problems: true } } },
  });
  return sets.map((s) => serializeSetSummary(s, s._count.problems));
}

export async function getProblemSet(userId: string, setId: string): Promise<ForgeProblemSetDetail | null> {
  const set = await prisma.forgeProblemSet.findFirst({
    where: { id: setId, userId },
    include: { problems: { orderBy: { createdAt: "asc" } } },
  });
  if (!set) return null;
  return {
    ...serializeSetSummary(set, set.problems.length),
    problems: set.problems.map(serializeProblem),
  };
}

function serializeSetSummary(s: any, problemCount: number): ForgeProblemSetSummary {
  let source: ForgeSource = { kind: "text", name: "" };
  try { source = JSON.parse(s.source) as ForgeSource; } catch { /* keep default */ }
  let conceptIds: string[] = [];
  try { conceptIds = JSON.parse(s.conceptIds) as string[]; } catch { /* keep default */ }
  return {
    id: s.id,
    title: s.title,
    format: s.format,
    difficulty: s.difficulty,
    count: problemCount,
    source,
    conceptIds,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function serializeProblem(p: any): ForgeProblemData {
  let options: ForgeProblemOption[] = [];
  try { options = JSON.parse(p.options) as ForgeProblemOption[]; } catch { /* keep default */ }
  let conceptIds: string[] = [];
  try { conceptIds = JSON.parse(p.conceptIds) as string[]; } catch { /* keep default */ }
  return {
    id: p.id,
    setId: p.setId,
    type: p.type,
    difficulty: p.difficulty,
    prompt: p.prompt,
    options,
    answer: p.answer,
    solution: p.solution,
    conceptIds,
    hint: p.hint,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function deleteProblemSet(userId: string, setId: string): Promise<void> {
  await prisma.forgeProblemSet.deleteMany({ where: { id: setId, userId } });
}

// ----- problem generation (LLM) -----

export interface ForgeGenerateInput {
  title?: string;
  source: ForgeSource;
  format?: "mcq" | "short_answer" | "step_by_step" | "mixed";
  difficulty?: "easy" | "medium" | "hard" | "adaptive";
  count?: number;
  // Optional: specific concept ids to target (from Atlas)
  conceptIds?: string[];
}

export async function generateProblemSet(
  userId: string,
  model: LlmModel,
  input: ForgeGenerateInput
): Promise<{ id: string; title: string; count: number }> {
  const format = input.format ?? "mixed";
  const difficulty = input.difficulty ?? "adaptive";
  const count = Math.max(3, Math.min(20, input.count ?? 8));

  // 1. Resolve source text.
  const sourceText = await resolveSourceText(userId, input.source);
  if (!sourceText || sourceText.trim().length < 50) {
    throw new Error("The source material is too short or empty. Provide a longer text, note, or file.");
  }

  // 2. For adaptive difficulty, get weak concepts from Atlas.
  let targetConcepts: AtlasConcept[] = [];
  let effectiveDifficulty = difficulty;
  if (difficulty === "adaptive") {
    const weak = await getWeakAtlasConcepts(userId);
    if (weak.length > 0) {
      targetConcepts = weak.slice(0, 10);
      effectiveDifficulty = "medium"; // adaptive resolves to medium but targets weak concepts
    } else {
      effectiveDifficulty = "medium";
    }
  }

  // 3. If specific conceptIds were provided, get those concepts.
  if (input.conceptIds && input.conceptIds.length > 0) {
    const atlas = await getAtlas(userId);
    if (atlas?.data) {
      targetConcepts = atlas.data.concepts.filter((c) => input.conceptIds!.includes(c.id));
    }
  }

  // 4. Build the LLM prompt.
  const conceptContext = targetConcepts.length > 0
    ? `\n\nFocus on these concepts (the student is weak in these areas):\n${targetConcepts.map((c) => `- ${c.label}: ${c.definition}`).join("\n")}`
    : "";

  const formatInstruction = format === "mixed"
    ? "Generate a mix of multiple-choice, short-answer, and step-by-step problems."
    : format === "mcq"
    ? "Generate only multiple-choice questions (each with 4 options)."
    : format === "short_answer"
    ? "Generate only short-answer questions (1-3 sentence answers)."
    : "Generate only step-by-step problems (with numbered solution steps).";

  const difficultyInstruction = effectiveDifficulty === "easy"
    ? "Make the problems EASY: basic recall and simple application."
    : effectiveDifficulty === "hard"
    ? "Make the problems HARD: complex multi-step reasoning and edge cases."
    : "Make the problems MEDIUM difficulty: require understanding and application.";

  const prompt = `You are an expert educator generating practice problems for a student. Based on the following source material, generate ${count} practice problems.

Source material:
---
${sourceText.slice(0, 15000)}
---
${conceptContext}

${formatInstruction}
${difficultyInstruction}

For each problem, provide:
- type: "mcq" (multiple-choice with 4 options), "short_answer", or "step_by_step"
- prompt: the question text (Markdown)
- options: for MCQ only, array of { id: "A"|"B"|"C"|"D", text: string }
- answer: the correct answer (option id for MCQ, text for short_answer, JSON array of step strings for step_by_step)
- solution: a full worked solution explaining HOW to arrive at the answer (Markdown)
- hint: a short hint the student can reveal if stuck
- conceptIds: array of concept labels (from the source or focus concepts) this problem tests

Respond with JSON: { "problems": [{ "type": string, "prompt": string, "options": [{ "id": string, "text": string }], "answer": string, "solution": string, "hint": string, "conceptLabels": string[] }] }`;

  const schemaHint = `Respond with { "problems": [{ "type": "mcq"|"short_answer"|"step_by_step", "prompt": string, "options": [{ "id": string, "text": string }], "answer": string, "solution": string, "hint": string, "conceptLabels": string[] }] }`;

  const result = await generateJson<{ problems: any[] }>(model, prompt, schemaHint);
  const rawProblems = (result.problems ?? []).slice(0, count);

  if (rawProblems.length === 0) {
    throw new Error("The AI could not generate problems from this source. Try a different source or add more detail.");
  }

  // 5. Map concept labels to Atlas concept ids.
  const atlas = await getAtlas(userId);
  const conceptLabelMap = new Map<string, string>();
  if (atlas?.data) {
    for (const c of atlas.data.concepts) {
      conceptLabelMap.set(c.label.toLowerCase(), c.id);
    }
  }

  // 6. Create the problem set + problems in the DB.
  const title = input.title?.trim() || input.source.name || "Practice Set";
  const set = await prisma.forgeProblemSet.create({
    data: {
      userId,
      title,
      format,
      difficulty,
      source: JSON.stringify(input.source),
      conceptIds: JSON.stringify(input.conceptIds ?? targetConcepts.map((c) => c.id)),
      count: rawProblems.length,
    },
  });

  for (const rp of rawProblems) {
    const type = (["mcq", "short_answer", "step_by_step"].includes(rp.type) ? rp.type : "short_answer") as ForgeProblemData["type"];
    const options = Array.isArray(rp.options) ? rp.options.slice(0, 6).map((o: any) => ({
      id: String(o.id ?? "").slice(0, 3),
      text: String(o.text ?? ""),
    })) : [];
    const conceptLabels: string[] = Array.isArray(rp.conceptLabels) ? rp.conceptLabels : [];
    const mappedConceptIds = conceptLabels
      .map((label) => conceptLabelMap.get(label.toLowerCase()))
      .filter((id): id is string => Boolean(id));

    await prisma.forgeProblem.create({
      data: {
        setId: set.id,
        userId,
        type,
        difficulty: effectiveDifficulty,
        prompt: String(rp.prompt ?? ""),
        options: JSON.stringify(options),
        answer: String(rp.answer ?? ""),
        solution: String(rp.solution ?? ""),
        conceptIds: JSON.stringify(mappedConceptIds),
        hint: String(rp.hint ?? ""),
      },
    });
  }

  return { id: set.id, title, count: rawProblems.length };
}

// ----- answer grading (LLM) -----

export async function gradeAttempt(
  userId: string,
  model: LlmModel,
  problemId: string,
  submitted: string
): Promise<ForgeAttemptData> {
  const problem = await prisma.forgeProblem.findFirst({
    where: { id: problemId, userId },
  });
  if (!problem) throw new Error("Problem not found");

  // For MCQ, we can grade deterministically.
  if (problem.type === "mcq") {
    const isCorrect = submitted.trim().toUpperCase() === problem.answer.trim().toUpperCase();
    const result = isCorrect ? "correct" : "incorrect";
    const feedback: ForgeFeedback = {
      summary: isCorrect
        ? "Correct! Well done."
        : `Incorrect. The correct answer is ${problem.answer}.`,
      suggestion: isCorrect ? undefined : "Review the solution below and try a variant problem.",
    };
    const attempt = await prisma.forgeAttempt.create({
      data: {
        userId,
        problemId,
        setId: problem.setId,
        submitted,
        result,
        score: isCorrect ? 1 : 0,
        feedback: JSON.stringify(feedback),
      },
    });
    return serializeAttempt(attempt);
  }

  // For short_answer and step_by_step, use the LLM to grade.
  const prompt = `You are grading a student's answer to a practice problem. Determine if the answer is correct, partially correct, or incorrect, and provide detailed feedback.

Problem:
${problem.prompt}

Correct answer:
${problem.answer}

Full worked solution:
${problem.solution}

Student's submitted answer:
${submitted}

Grade the answer and provide feedback. For step-by-step problems, evaluate each step if the student provided steps.

Respond with JSON: { "result": "correct"|"partial"|"incorrect", "score": 0-1, "summary": string, "steps": [{ "step": string, "correct": boolean, "explanation": string }], "misconception": string|null, "suggestion": string|null }`;

  const schemaHint = `Respond with { "result": "correct"|"partial"|"incorrect", "score": number, "summary": string, "steps": [{ "step": string, "correct": boolean, "explanation": string }], "misconception": string|null, "suggestion": string|null }`;

  const grading = await generateJson<ForgeFeedback & { result: string; score: number }>(model, prompt, schemaHint);

  const result = (["correct", "partial", "incorrect"].includes(grading.result) ? grading.result : "incorrect") as ForgeAttemptData["result"];
  const score = Math.max(0, Math.min(1, Number(grading.score ?? (result === "correct" ? 1 : result === "partial" ? 0.5 : 0))));
  const feedback: ForgeFeedback = {
    summary: String(grading.summary ?? ""),
    steps: grading.steps,
    misconception: grading.misconception ?? undefined,
    suggestion: grading.suggestion ?? undefined,
  };

  const attempt = await prisma.forgeAttempt.create({
    data: {
      userId,
      problemId,
      setId: problem.setId,
      submitted,
      result,
      score,
      feedback: JSON.stringify(feedback),
    },
  });

  return serializeAttempt(attempt);
}

function serializeAttempt(a: any): ForgeAttemptData {
  let feedback: ForgeFeedback = { summary: "" };
  try { feedback = JSON.parse(a.feedback) as ForgeFeedback; } catch { /* keep default */ }
  return {
    id: a.id,
    problemId: a.problemId,
    setId: a.setId,
    submitted: a.submitted,
    result: a.result,
    score: a.score,
    feedback,
    variantGenerated: a.variantGenerated,
    createdAt: a.createdAt.toISOString(),
  };
}

// ----- variant problem generation -----

/** Generate a variant of a problem targeting the same misconception. */
export async function generateVariant(
  userId: string,
  model: LlmModel,
  problemId: string
): Promise<{ id: string; setId: string }> {
  const problem = await prisma.forgeProblem.findFirst({
    where: { id: problemId, userId },
  });
  if (!problem) throw new Error("Problem not found");

  // Mark the original attempt as having generated a variant.
  await prisma.forgeAttempt.updateMany({
    where: { problemId, userId },
    data: { variantGenerated: true },
  });

  const prompt = `Generate a VARIANT of the following practice problem. The variant should test the SAME concept but with different numbers, context, or framing — so the student gets a fresh attempt at the same skill.

Original problem:
${problem.prompt}

Original answer:
${problem.answer}

Original solution:
${problem.solution}

Generate a new problem that:
- Tests the same underlying concept
- Uses different specific values/context
- Is at the same difficulty level
- Has a full worked solution

Respond with JSON: { "type": "${problem.type}", "prompt": string, "options": [{ "id": string, "text": string }], "answer": string, "solution": string, "hint": string, "conceptLabels": string[] }`;

  const schemaHint = `Respond with { "type": "mcq"|"short_answer"|"step_by_step", "prompt": string, "options": [{ "id": string, "text": string }], "answer": string, "solution": string, "hint": string, "conceptLabels": string[] }`;

  const result = await generateJson<any>(model, prompt, schemaHint);

  const variant = await prisma.forgeProblem.create({
    data: {
      setId: problem.setId,
      userId,
      type: problem.type,
      difficulty: problem.difficulty,
      prompt: String(result.prompt ?? ""),
      options: JSON.stringify(Array.isArray(result.options) ? result.options : []),
      answer: String(result.answer ?? ""),
      solution: String(result.solution ?? ""),
      conceptIds: problem.conceptIds,
      hint: String(result.hint ?? ""),
    },
  });

  return { id: variant.id, setId: problem.setId };
}

// ----- attempt history -----

export async function listAttempts(userId: string, setId?: string): Promise<ForgeAttemptData[]> {
  const attempts = await prisma.forgeAttempt.findMany({
    where: { userId, ...(setId ? { setId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return attempts.map(serializeAttempt);
}

export async function getStats(userId: string): Promise<ForgeStats> {
  const [sets, problems, attempts] = await Promise.all([
    prisma.forgeProblemSet.count({ where: { userId } }),
    prisma.forgeProblem.count({ where: { userId } }),
    prisma.forgeAttempt.findMany({
      where: { userId },
      select: { score: true },
    }),
  ]);
  const avgScore = attempts.length > 0
    ? attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length
    : 0;

  // Count unique concepts targeted.
  const allSets = await prisma.forgeProblemSet.findMany({
    where: { userId },
    select: { conceptIds: true },
  });
  const conceptSet = new Set<string>();
  for (const s of allSets) {
    try {
      const ids = JSON.parse(s.conceptIds) as string[];
      ids.forEach((id) => conceptSet.add(id));
    } catch { /* skip */ }
  }

  return {
    totalSets: sets,
    totalProblems: problems,
    totalAttempts: attempts.length,
    avgScore,
    conceptsTargeted: conceptSet.size,
  };
}
