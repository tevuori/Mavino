// ===== Study Hub prompt builders =====
// Focused prompts for each study workflow. Used by routes/study.ts.

export type StudyLanguage = "en" | "cs";

/** Returns a language instruction appended to prompts so the LLM outputs
 *  in the user's chosen language. English is the default (no instruction). */
export function langInstr(lang?: StudyLanguage): string {
  if (lang === "cs") {
    return "\n\nIMPORTANT: Write your ENTIRE response in Czech (čeština) — all questions, answers, explanations, headings, and labels must be in Czech. Keep technical terms in their accepted Czech form.";
  }
  return "";
}

export interface FlashcardSpec {
  front: string;
  back: string;
}

export interface QuizQuestionSpec {
  id: number;
  type: "mcq" | "short";
  prompt: string;
  options?: string[]; // for mcq
  answer: string; // model answer (for short) or correct option text (for mcq)
}

export interface SyllabusTaskSpec {
  title: string;
  dueDate?: string | null; // ISO date or null
  priority?: "LOW" | "MEDIUM" | "HIGH";
}

export function flashcardsPrompt(sourceText: string, count: number, mode: string, lang?: StudyLanguage): string {
  const modeInstr =
    mode === "cloze"
      ? 'Cloze deletion style: the "front" is a sentence with a key term replaced by "_____", and the "back" is the missing term. Generate cards that test recall of specific terms within context.'
      : mode === "concept"
      ? 'Focus on definitions and concepts ("What is X?" / "Define X").'
      : mode === "factual"
      ? "Focus on specific facts and details (dates, numbers, names, properties)."
      : "Use a balance of concept definitions and specific facts.";
  return `Generate ${count} flashcards from the study material below. Each card must have a concise question on the front and a clear, correct answer on the back. ${modeInstr}

Return JSON: { "cards": [ { "front": "...", "back": "..." }, ... ] }

Study material:
"""
${sourceText}
"""${langInstr(lang)}`;
}

export function flashcardsSchemaHint(): string {
  return 'Schema: { "cards": [ { "front": string, "back": string } ] }';
}

export function summarizePrompt(sourceText: string, mode: string, lang?: StudyLanguage): string {
  const modeInstr =
    mode === "tldr"
      ? "a 2-3 sentence TL;DR"
      : mode === "outline"
      ? "a structured outline with headings and bullet points"
      : "5-8 key bullet points";
  return `Summarize the material below as ${modeInstr}. Use clear Markdown formatting. Be accurate and do not invent information not present in the source.

Material:
"""
${sourceText}
"""${langInstr(lang)}`;
}

export function explainPrompt(sourceText: string, depth: string, lang?: StudyLanguage): string {
  const depthInstr =
    depth === "eli5"
      ? "as if explaining to a 5-year-old (simple words, analogies, no jargon)"
      : depth === "expert"
      ? "at an advanced/expert level with technical depth, edge cases, and nuance"
      : "at a standard undergraduate level — clear and thorough but not overly simplified";
  return `Explain the following topic/material ${depthInstr}. Use Markdown with headings and examples where helpful.

Material:
"""
${sourceText}
"""${langInstr(lang)}`;
}

export function studyGuidePrompt(notes: { title: string; content: string }[]): string {
  const combined = notes
    .map((n) => `### ${n.title}\n\n${n.content}`)
    .join("\n\n---\n\n");
  return `Create a comprehensive study guide / cheat sheet that consolidates the following notes. Organize by topic, include key definitions, formulas, and important facts. Use clear Markdown with headings, bullet points, and tables where useful. Do not invent information not present in the sources.

Notes:
"""
${combined}
"""`;
}

export function syllabusTasksPrompt(sourceText: string, lang?: StudyLanguage): string {
  return `Extract actionable study tasks (assignments, readings, exams, deadlines) from the material below. For each task, provide a short title, an optional due date (ISO format YYYY-MM-DD if explicitly mentioned, otherwise null), and a priority.

Return JSON: { "tasks": [ { "title": "...", "dueDate": "2025-01-31" | null, "priority": "LOW" | "MEDIUM" | "HIGH" }, ... ] }

Material:
"""
${sourceText}
"""${langInstr(lang)}`;
}

export function syllabusTasksSchemaHint(): string {
  return 'Schema: { "tasks": [ { "title": string, "dueDate": string|null, "priority": "LOW"|"MEDIUM"|"HIGH" } ] }';
}

export function quizGeneratePrompt(
  sourceText: string,
  count: number,
  types: string[],
  lang?: StudyLanguage
): string {
  const typeInstr = types.includes("mcq") && types.includes("short")
    ? "a mix of multiple-choice (mcq) and short-answer (short) questions"
    : types.includes("mcq")
    ? "only multiple-choice (mcq) questions"
    : types.includes("short")
    ? "only short-answer (short) questions"
    : "a mix of multiple-choice (mcq) and short-answer (short) questions";
  return `Generate ${count} quiz questions from the study material below. Use ${typeInstr}. For mcq questions, provide 4 options and the correct answer (the exact text of the correct option). For short questions, provide the model answer. Each question must have a unique sequential id starting at 1.

Return JSON: { "questions": [ { "id": 1, "type": "mcq", "prompt": "...", "options": ["a","b","c","d"], "answer": "b" }, { "id": 2, "type": "short", "prompt": "...", "answer": "..." } ] }

Study material:
"""
${sourceText}
"""${langInstr(lang)}`;
}

export function quizGenerateSchemaHint(): string {
  return 'Schema: { "questions": [ { "id": number, "type": "mcq"|"short", "prompt": string, "options"?: string[], "answer": string } ] }';
}

export function quizGradePrompt(
  sourceText: string,
  question: { type: string; prompt: string; answer: string },
  userAnswer: string,
  lang?: StudyLanguage
): string {
  return `You are grading a quiz answer. Determine if the student's answer is correct relative to the model answer. Be lenient on wording but strict on correctness.

Question: ${question.prompt}
Model answer: ${question.answer}
Student's answer: ${userAnswer}

Return JSON: { "correct": boolean, "explanation": "brief explanation of why it is correct or incorrect", "modelAnswer": "the ideal answer" }${langInstr(lang)}`;
}

export function quizGradeSchemaHint(): string {
  return 'Schema: { "correct": boolean, "explanation": string, "modelAnswer": string }';
}

// ===== Notetaking (from URL / PDF) =====

export type NoteStyle = "cornell" | "outline" | "summary" | "bullets";
export type NoteDetail = "brief" | "standard" | "detailed";

export interface NotetakingOptions {
  /** How thorough the notes should be. Defaults to "standard". */
  detail?: NoteDetail;
  /** Freeform user instructions describing how the notes should be structured
   *  (e.g. "start with a glossary, then one section per chapter, end with 5
   *  review questions"). Injected verbatim into the prompt. */
  customStructure?: string;
}

export function notetakingPrompt(
  sourceText: string,
  style: NoteStyle,
  sourceLabel: string,
  options?: NotetakingOptions
): string {
  const styleInstr =
    style === "cornell"
      ? "Cornell notes format: organize into 'Cues / Questions' (left), 'Notes' (right, main body with bullet points), and a 'Summary' at the bottom (2-3 sentences). Use a Markdown structure with these sections clearly labeled."
      : style === "outline"
      ? "A structured outline with hierarchical headings (##, ###) and bullet points under each section."
      : style === "summary"
      ? "A concise summary: a 2-3 sentence overview followed by the key points as bullets."
      : "Clear bullet-point notes organized by topic with ## headings.";
  const detail = options?.detail ?? "standard";
  const detailInstr =
    detail === "brief"
      ? "Keep the notes concise — capture only the key points, essential definitions, and main takeaways. Avoid exhaustive detail."
      : detail === "detailed"
      ? "Be thorough and detailed — capture all important concepts, definitions, examples, formulas, and supporting details from the source. Prefer completeness over brevity."
      : "Capture the key points with reasonable detail — include important definitions and explanations, but stay focused.";
  const customInstr = options?.customStructure?.trim()
    ? `\n\nThe user has requested the following specific structure for the notes. Follow it as closely as possible while staying accurate to the source material (skip any part that does not apply to this material):\n"""\n${options.customStructure.trim()}\n"""`
    : "";
  return `Take structured notes from the source material below. Use ${styleInstr}. ${detailInstr} Be accurate — do not invent information not present in the source. Use Markdown formatting.${customInstr}

Source: ${sourceLabel}

Material:
"""
${sourceText}
"""`;
}

// ===== Research (multi-step web research with citations) =====

export function researchSynthesizePrompt(
  query: string,
  sources: { index: number; title: string; url: string; content: string }[]
): string {
  const sourcesBlock = sources
    .map(
      (s) =>
        `--- SOURCE [${s.index}] ---\nTitle: ${s.title}\nURL: ${s.url}\n\n${s.content}\n`
    )
    .join("\n");
  return `You are a research assistant. Using ONLY the sources provided below, write a clear, well-organized answer to the user's question. Cite sources inline using [1], [2], etc. matching the SOURCE labels. If the sources don't contain enough information to answer fully, say so explicitly. Do not invent facts. Use Markdown formatting with headings where helpful. Include a "## Sources" section at the end listing each cited source as \`[n] Title — URL\`.

User's question: ${query}

${sourcesBlock}`;
}

export function researchRefinePrompt(originalQuery: string): string {
  return `The user wants to research: "${originalQuery}". Generate ONE alternative search query that would find complementary or more specific information (e.g. a different phrasing, a sub-topic, or a recent-development angle). Return ONLY the query text, no quotes, no explanation.`;
}

// ===== Source-grounded Q&A (NotebookLM-style) =====
// Sources are injected as numbered SOURCE blocks so the model can cite inline
// with [n] markers that the client renders as clickable citation chips.

export interface GroundedSource {
  index: number;
  name: string;
  /** "note" | "file" | "paste" | "moodle" | "url" — used by the client to open. */
  kind: string;
  /** Note/file id, "paste", or the URL. */
  refId: string;
  text: string;
}

/** Cap the total injected source text to protect context windows. Each source
 *  is truncated proportionally so no single source dominates. */
export function budgetSources(sources: GroundedSource[], totalBudget = 60000): GroundedSource[] {
  const total = sources.reduce((s, x) => s + x.text.length, 0);
  if (total <= totalBudget) return sources;
  const scale = totalBudget / total;
  return sources.map((s) => {
    const cap = Math.max(2000, Math.floor(s.text.length * scale));
    return {
      ...s,
      text: s.text.length > cap ? s.text.slice(0, cap) + "\n\n[…truncated…]" : s.text,
    };
  });
}

export function groundedQaSystemPrompt(sources: GroundedSource[], lang?: StudyLanguage): string {
  const budgeted = budgetSources(sources);
  const blocks = budgeted
    .map(
      (s) =>
        `--- SOURCE [${s.index}] (${s.kind}: ${s.name}) ---\n${s.text}\n`
    )
    .join("\n");
  return `You are Mavino, a study assistant inside the Mavino Student OS. You answer the student's questions using ONLY the sources provided below. Be clear, accurate, and helpful, and use Markdown formatting with headings and lists where helpful.

CRITICAL CITATION RULES:
- Every factual statement or claim MUST be followed by an inline citation matching the source it came from, using the form [1], [2], etc. matching the SOURCE labels above.
- If a statement draws on multiple sources, cite all of them: [1][3].
- If the sources do not contain enough information to answer fully, say so explicitly and do NOT invent or assume facts not present in the sources.
- Do not use outside knowledge to fill gaps — only the provided sources.
- At the end of your answer, include a "## Sources" section listing each cited source as \`[n] <name>\` (one per line). Only list sources you actually cited.

SOURCES:
${blocks}${langInstr(lang)}`;
}

// ===== Podcast / audio overview script =====

export function podcastScriptPrompt(
  sources: { index: number; name: string; text: string }[],
  host1Label: string,
  host2Label: string,
  lang?: StudyLanguage
): string {
  const budgeted = budgetSources(
    sources.map((s) => ({ ...s, kind: "source", refId: String(s.index) })),
    50000
  );
  const blocks = budgeted
    .map((s) => `--- SOURCE [${s.index}]: ${s.name} ---\n${s.text}\n`)
    .join("\n");
  return `You are writing an engaging, conversational podcast script that gives an audio overview of the study material below. Two hosts discuss the material in a natural, lively way — like a popular educational podcast.

FORMAT RULES (follow exactly so a text-to-speech engine can read it):
- Each spoken line MUST start with the host label followed by a colon, e.g. "${host1Label}: ..." or "${host2Label}: ...".
- Alternate between the two hosts. Keep each turn to 1-3 sentences.
- Do NOT include stage directions, sound effects, parentheses, or markdown headings inside the dialogue. Only \`Host: spoken text\` lines.
- Cover the key concepts, important details, and a couple of concrete examples from the sources. Make it feel like a real conversation: ask each other questions, react, summarize.
- Aim for roughly 5-8 minutes of spoken audio (about 60-100 short lines total).
- Stay faithful to the sources — do not invent facts. If something is unclear in the sources, the hosts can acknowledge it.
- Start with a brief friendly intro (host 1 welcomes listeners and introduces the topic) and end with a short recap + sign-off.

SOURCES:
${blocks}

Write the full script now, starting with "${host1Label}:".${langInstr(lang)}`;
}

// ===== Citation-aware variants for existing study materials =====

export function studyGuideCitedPrompt(
  notes: { index: number; name: string; content: string }[],
  lang?: StudyLanguage
): string {
  const combined = notes
    .map((n) => `### SOURCE [${n.index}]: ${n.name}\n\n${n.content}`)
    .join("\n\n---\n\n");
  return `Create a comprehensive study guide / cheat sheet that consolidates the following sources. Organize by topic, include key definitions, formulas, and important facts. Use clear Markdown with headings, bullet points, and tables where useful.

CITATION RULES:
- Do not invent information not present in the sources.
- After key facts or section content, cite the source(s) they came from as inline [n] markers matching the SOURCE labels above.
- Include a "## Sources" section at the end listing each cited source as \`[n] <name>\`.

Sources:
"""
${combined}
"""${langInstr(lang)}`;
}

export function summarizeCitedPrompt(sourceText: string, mode: string, sourceLabel: string, lang?: StudyLanguage): string {
  const modeInstr =
    mode === "tldr"
      ? "a 2-3 sentence TL;DR"
      : mode === "outline"
      ? "a structured outline with headings and bullet points"
      : "5-8 key bullet points";
  return `Summarize the material below as ${modeInstr}. Use clear Markdown formatting. Be accurate and do not invent information not present in the source. After key points, cite the source as [1] (there is a single source: ${sourceLabel}). Include a "## Sources" section at the end: \`[1] ${sourceLabel}\`.

Material:
"""
${sourceText}
"""${langInstr(lang)}`;
}

export function explainCitedPrompt(sourceText: string, depth: string, sourceLabel: string, lang?: StudyLanguage): string {
  const depthInstr =
    depth === "eli5"
      ? "as if explaining to a 5-year-old (simple words, analogies, no jargon)"
      : depth === "expert"
      ? "at an advanced/expert level with technical depth, edge cases, and nuance"
      : "at a standard undergraduate level — clear and thorough but not overly simplified";
  return `Explain the following topic/material ${depthInstr}. Use Markdown with headings and examples where helpful. Do not invent information not present in the source. After key statements, cite the source as [1] (single source: ${sourceLabel}). Include a "## Sources" section at the end: \`[1] ${sourceLabel}\`.

Material:
"""
${sourceText}
"""${langInstr(lang)}`;
}

export interface CitedFlashcardSpec {
  front: string;
  back: string;
  /** 1-based source index the card was derived from. */
  source?: number;
}

export function flashcardsCitedPrompt(
  sources: { index: number; name: string; text: string }[],
  count: number,
  mode: string,
  lang?: StudyLanguage
): string {
  const modeInstr =
    mode === "cloze"
      ? 'Cloze deletion style: the "front" is a sentence with a key term replaced by "_____", and the "back" is the missing term. Generate cards that test recall of specific terms within context.'
      : mode === "concept"
      ? 'Focus on definitions and concepts ("What is X?" / "Define X").'
      : mode === "factual"
      ? "Focus on specific facts and details (dates, numbers, names, properties)."
      : "Use a balance of concept definitions and specific facts.";
  const blocks = sources
    .map((s) => `--- SOURCE [${s.index}]: ${s.name} ---\n${s.text}\n`)
    .join("\n");
  return `Generate ${count} flashcards from the study material below. Each card must have a concise question on the front and a clear, correct answer on the back. ${modeInstr} For each card, set "source" to the 1-based index of the SOURCE it was derived from.

Return JSON: { "cards": [ { "front": "...", "back": "...", "source": 1 }, ... ] }

Study material:
${blocks}${langInstr(lang)}`;
}

export function flashcardsCitedSchemaHint(): string {
  return 'Schema: { "cards": [ { "front": string, "back": string, "source"?: number } ] }';
}

export function quizCitedPrompt(
  sources: { index: number; name: string; text: string }[],
  count: number,
  types: string[],
  lang?: StudyLanguage
): string {
  const typeInstr = types.includes("mcq") && types.includes("short")
    ? "a mix of multiple-choice (mcq) and short-answer (short) questions"
    : types.includes("mcq")
    ? "only multiple-choice (mcq) questions"
    : types.includes("short")
    ? "only short-answer (short) questions"
    : "a mix of multiple-choice (mcq) and short-answer (short) questions";
  const blocks = sources
    .map((s) => `--- SOURCE [${s.index}]: ${s.name} ---\n${s.text}\n`)
    .join("\n");
  return `Generate ${count} quiz questions from the study material below. Use ${typeInstr}. For mcq questions, provide 4 options and the correct answer (the exact text of the correct option). For short questions, provide the model answer. Each question must have a unique sequential id starting at 1. After each question's prompt, append the source citation in the form "[n]" matching the SOURCE the question is drawn from.

Return JSON: { "questions": [ { "id": 1, "type": "mcq", "prompt": "... [1]", "options": ["a","b","c","d"], "answer": "b" }, { "id": 2, "type": "short", "prompt": "... [2]", "answer": "..." } ] }

Study material:
${blocks}${langInstr(lang)}`;
}

export function quizCitedSchemaHint(): string {
  return 'Schema: { "questions": [ { "id": number, "type": "mcq"|"short", "prompt": string, "options"?: string[], "answer": string } ] }';
}

// ===== Lecture Video → Notes (per-slide note generation) =====

export function lectureSlideNotePrompt(
  slideContent: string,
  transcriptText: string,
  slideIndex: number,
  totalSlides: number,
  style: NoteStyle,
  options?: NotetakingOptions,
  lang?: StudyLanguage
): string {
  const styleInstr =
    style === "cornell"
      ? "Cornell notes: organize into 'Cues / Questions' (left column) and 'Notes' (right column, main content with bullet points). Do NOT add a summary yet — that will be added at the end for the whole lecture."
      : style === "outline"
      ? "A structured outline with hierarchical headings (###, ####) and bullet points under each section."
      : style === "summary"
      ? "A concise summary: the key points as bullets, focusing on what matters most."
      : "Clear bullet-point notes organized by topic.";
  const detail = options?.detail ?? "standard";
  const detailInstr =
    detail === "brief"
      ? "Be concise — only the key points and essential definitions."
      : detail === "detailed"
      ? "Be thorough — capture all important concepts, definitions, examples, formulas, and details."
      : "Capture key points with reasonable detail.";
  const customInstr = options?.customStructure?.trim()
    ? `\n\nThe user has requested the following structure: "${options.customStructure.trim()}"`
    : "";

  return `You are taking notes from a lecture video. This is slide ${slideIndex + 1} of ${totalSlides}. Generate structured notes from the slide content and the professor's spoken commentary.

RULES:
- Merge information from both the slide and the transcript — the transcript often adds context, examples, and explanations not on the slide.
- ${styleInstr}
- ${detailInstr}
- Use Markdown formatting.
- Do NOT invent information not present in either source.
- Do NOT include a title/heading for the slide number — that will be added by the system.${customInstr}

SLIDE CONTENT:
"""
${slideContent || "(No text extracted from slide)"}
"""

PROFESSOR'S COMMENTARY (transcript):
"""
${transcriptText || "(No transcript available for this segment)"}
"""${langInstr(lang)}`;
}

export function lectureSummaryPrompt(
  allSlideNotes: string,
  style: NoteStyle,
  lang?: StudyLanguage
): string {
  const summaryInstr =
    style === "cornell"
      ? "Write a 3-5 sentence 'Summary' section that captures the main takeaways of the entire lecture — this is the bottom section of Cornell notes."
      : "Write a concise 'Lecture Summary' (3-5 sentences) capturing the main takeaways of the entire lecture.";
  return `${summaryInstr} Base it ONLY on the notes below — do not invent information.

Notes from all slides:
"""
${allSlideNotes}
"""${langInstr(lang)}`;
}

// ===== Concept graph (knowledge graph) =====
// A single-pass structured extraction of a source-set into concepts, facts,
// and relationships. Persisted (services/study/graph.ts) and reused to
// derive flashcards/quizzes/summaries/explanations/study guides so that
// feature isn't re-analyzing raw source text every time.

export function conceptGraphPrompt(
  sources: { index: number; name: string; text: string }[],
  lang?: StudyLanguage
): string {
  const blocks = sources
    .map((s) => `--- SOURCE [${s.index}]: ${s.name} ---\n${s.text}\n`)
    .join("\n");
  return `You are building a knowledge graph from the study material below. Extract the key concepts, terms, people, events, formulas, and processes as graph NODES, and the relationships between them as graph EDGES. This graph will be the single source of truth used to later generate flashcards, quizzes, summaries, explanations, and study guides — so it must be complete, accurate, and grounded ONLY in the material provided.

RULES:
- Extract 8-30 concepts depending on how much material there is. Prefer fewer, well-defined concepts over many shallow ones.
- Each concept needs: a short "id" (lowercase-kebab-case slug, unique), a human-readable "label", a "type" (one of: concept, term, person, event, formula, process, date, other), a 1-2 sentence grounded "definition", an "importance" score from 1 (minor/supporting) to 5 (central to the material), a list of "facts" (specific supporting details, each with the text and the 1-based SOURCE index/indexes it came from), and "sourceIndexes" (which SOURCE(s) the concept itself is discussed in).
- Each relationship needs "from" and "to" (concept ids, both must exist in your concepts list), a short "relation" label describing the connection (e.g. "causes", "is part of", "depends on", "precedes", "contrasts with", "is an example of", "is defined by"), and "sourceIndexes".
- Do not invent facts, concepts, or relationships not supported by the material.
- Write a "summary": a 2-4 sentence overview of the material as a whole.

Return JSON:
{
  "summary": "...",
  "concepts": [
    {
      "id": "photosynthesis",
      "label": "Photosynthesis",
      "type": "process",
      "definition": "...",
      "importance": 5,
      "facts": [ { "text": "...", "sourceIndexes": [1] } ],
      "sourceIndexes": [1]
    }
  ],
  "relationships": [
    { "from": "photosynthesis", "to": "chlorophyll", "relation": "requires", "sourceIndexes": [1] }
  ]
}

Study material:
${blocks}${langInstr(lang)}`;
}

export function conceptGraphSchemaHint(): string {
  return 'Schema: { "summary": string, "concepts": [ { "id": string, "label": string, "type": "concept"|"term"|"person"|"event"|"formula"|"process"|"date"|"other", "definition": string, "importance": number, "facts": [ { "text": string, "sourceIndexes": number[] } ], "sourceIndexes": number[] } ], "relationships": [ { "from": string, "to": string, "relation": string, "sourceIndexes": number[] } ] }';
}

export interface ConceptGraphDataLike {
  summary: string;
  sources: { index: number; name: string }[];
  concepts: {
    id: string;
    label: string;
    type: string;
    definition: string;
    importance: number;
    facts: { text: string; sourceIndexes: number[] }[];
    sourceIndexes: number[];
  }[];
  relationships: { from: string; to: string; relation: string; sourceIndexes: number[] }[];
}

/** Render the compact graph JSON (not the original source text) into a prompt block. */
function graphBlock(graph: ConceptGraphDataLike): string {
  const conceptsSorted = [...graph.concepts].sort((a, b) => b.importance - a.importance);
  const conceptLines = conceptsSorted
    .map((c) => {
      const facts = c.facts.map((f) => `    - ${f.text} [${f.sourceIndexes.join(",")}]`).join("\n");
      return `- [${c.id}] ${c.label} (${c.type}, importance ${c.importance}) [${c.sourceIndexes.join(",")}]: ${c.definition}${facts ? "\n" + facts : ""}`;
    })
    .join("\n");
  const relLines = graph.relationships
    .map((r) => `- ${r.from} --${r.relation}--> ${r.to} [${r.sourceIndexes.join(",")}]`)
    .join("\n");
  const sourceLines = graph.sources.map((s) => `[${s.index}] ${s.name}`).join("\n");
  return `SUMMARY: ${graph.summary}

CONCEPTS:
${conceptLines}

RELATIONSHIPS:
${relLines}

SOURCES:
${sourceLines}`;
}

export function flashcardsFromGraphPrompt(
  graph: ConceptGraphDataLike,
  count: number,
  mode: string,
  lang?: StudyLanguage
): string {
  const modeInstr =
    mode === "cloze"
      ? 'Cloze deletion style: the "front" is a sentence with a key term replaced by "_____", and the "back" is the missing term.'
      : mode === "concept"
      ? 'Focus on definitions and concepts ("What is X?" / "Define X").'
      : mode === "factual"
      ? "Focus on specific facts and details from the concepts' fact lists."
      : "Use a balance of concept definitions and specific facts.";
  return `Generate ${count} flashcards from the knowledge graph below (already extracted from the study material — do not need to re-derive concepts, just phrase them as cards). Each card must have a concise question on the front and a clear, correct answer on the back. ${modeInstr} For each card, set "source" to a SOURCE index that supports it (see the SOURCES list).

Return JSON: { "cards": [ { "front": "...", "back": "...", "source": 1 }, ... ] }

${graphBlock(graph)}${langInstr(lang)}`;
}

export function quizFromGraphPrompt(
  graph: ConceptGraphDataLike,
  count: number,
  types: string[],
  lang?: StudyLanguage
): string {
  const typeInstr = types.includes("mcq") && types.includes("short")
    ? "a mix of multiple-choice (mcq) and short-answer (short) questions"
    : types.includes("mcq")
    ? "only multiple-choice (mcq) questions"
    : types.includes("short")
    ? "only short-answer (short) questions"
    : "a mix of multiple-choice (mcq) and short-answer (short) questions";
  return `Generate ${count} quiz questions from the knowledge graph below (already extracted from the study material). Use ${typeInstr}. For mcq questions, provide 4 options and the correct answer (exact text of the correct option). For short questions, provide the model answer. Each question needs a unique sequential id starting at 1.

Return JSON: { "questions": [ { "id": 1, "type": "mcq", "prompt": "...", "options": ["a","b","c","d"], "answer": "b" }, { "id": 2, "type": "short", "prompt": "...", "answer": "..." } ] }

${graphBlock(graph)}${langInstr(lang)}`;
}

export function summarizeFromGraphPrompt(graph: ConceptGraphDataLike, mode: string, lang?: StudyLanguage): string {
  const modeInstr =
    mode === "tldr"
      ? "a 2-3 sentence TL;DR"
      : mode === "outline"
      ? "a structured outline with headings and bullet points, organized by concept"
      : "5-8 key bullet points";
  return `Using ONLY the knowledge graph below (already extracted from the study material), write a summary as ${modeInstr}. Use clear Markdown formatting. After key points, cite the source(s) as [n] matching the SOURCES list. Include a "## Sources" section at the end listing each cited source as \`[n] <name>\`.

${graphBlock(graph)}${langInstr(lang)}`;
}

export function explainFromGraphPrompt(graph: ConceptGraphDataLike, depth: string, lang?: StudyLanguage): string {
  const depthInstr =
    depth === "eli5"
      ? "as if explaining to a 5-year-old (simple words, analogies, no jargon)"
      : depth === "expert"
      ? "at an advanced/expert level with technical depth, edge cases, and nuance"
      : "at a standard undergraduate level — clear and thorough but not overly simplified";
  return `Using ONLY the knowledge graph below (already extracted from the study material), explain the material ${depthInstr}. Use Markdown with headings and examples drawn from the concepts/facts/relationships. After key statements, cite the source(s) as [n] matching the SOURCES list. Include a "## Sources" section at the end listing each cited source as \`[n] <name>\`.

${graphBlock(graph)}${langInstr(lang)}`;
}

/** Pure-template study guide renderer — no LLM call needed once the graph exists. */
export function studyGuideFromGraph(graph: ConceptGraphDataLike): string {
  const conceptsSorted = [...graph.concepts].sort((a, b) => b.importance - a.importance);
  const lines: string[] = [];
  lines.push(`# Study Guide`);
  lines.push("");
  lines.push(graph.summary);
  lines.push("");
  for (const c of conceptsSorted) {
    lines.push(`## ${c.label}`);
    lines.push("");
    lines.push(`_${c.type}_ — ${c.definition} ${c.sourceIndexes.map((i) => `[${i}]`).join("")}`);
    if (c.facts.length > 0) {
      lines.push("");
      for (const f of c.facts) {
        lines.push(`- ${f.text} ${f.sourceIndexes.map((i) => `[${i}]`).join("")}`);
      }
    }
    lines.push("");
  }
  if (graph.relationships.length > 0) {
    lines.push(`## Relationships`);
    lines.push("");
    const byId = new Map(graph.concepts.map((c) => [c.id, c.label]));
    for (const r of graph.relationships) {
      const from = byId.get(r.from) ?? r.from;
      const to = byId.get(r.to) ?? r.to;
      lines.push(`- **${from}** ${r.relation} **${to}** ${r.sourceIndexes.map((i) => `[${i}]`).join("")}`);
    }
    lines.push("");
  }
  lines.push(`## Sources`);
  lines.push("");
  for (const s of graph.sources) {
    lines.push(`[${s.index}] ${s.name}`);
  }
  return lines.join("\n");
}
