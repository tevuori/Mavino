// ===== Compass: research & literature review service (Pro tier) =====
// Manages research projects, paper corpora, citation graphs, related-work
// search, reading-gap analysis, and LLM-drafted literature reviews.
//
// Paper ingestion: papers can come from VFiles (PDFs in Files), URLs
// (fetched + extracted), or manual entry. For file/URL sources, text is
// extracted (PDF via pdf-parse, HTML via fetcher) and stored for LLM
// processing.
//
// LLM extraction: for each paper with full text, an LLM pass extracts key
// concepts and detected citation references (titles of cited works). These
// become the citation graph edges. Fire-and-forget + polling per paper
// (extractStatus: "idle" → "extracting" → "done"/"error").
//
// Literature review draft: given a project's research question + all papers
// + their concepts + the citation graph, an LLM generates a structured
// Markdown literature review with inline citations. Fire-and-forget +
// polling (CompassReview.status: "building" → "ready"/"error"), same
// pattern as AtlasGraph.

import path from "node:path";
import { readFile } from "node:fs/promises";
import type { LlmModel } from "multi-llm-ts";
import prisma from "../db/client";
import { generateJson, generateText } from "./study/llm-json";
import { fetchUrl } from "./fetcher";
import { webSearch } from "./search";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const MAX_PAPER_CHARS = 30000;

// ----- types (serialized to/from JSON) -----

export interface PaperConcept {
  label: string;
  type: string;
  definition: string;
}

export interface ExtractedCitation {
  targetTitle: string;
  context: string;
}

export interface PaperExtractionResult {
  concepts: PaperConcept[];
  citations: ExtractedCitation[];
  abstract: string;
}

// ----- helpers -----

function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function truncatePaper(text: string): string {
  const clean = sanitizeText(text);
  if (clean.length <= MAX_PAPER_CHARS) return clean;
  return clean.slice(0, MAX_PAPER_CHARS) + "\n\n[…truncated…]";
}

function isPdfFile(name: string, mime: string): boolean {
  if (mime === "application/pdf") return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf";
}

async function extractPdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// ----- project CRUD -----

export async function listProjects(userId: string) {
  const projects = await prisma.compassProject.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { papers: true } },
    },
  });
  return projects.map((p) => ({
    id: p.id,
    title: p.title,
    researchQuestion: p.researchQuestion,
    notes: p.notes,
    paperCount: p._count.papers,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function getProject(userId: string, projectId: string) {
  const project = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
    include: {
      papers: { orderBy: { createdAt: "desc" } },
      citations: true,
      review: true,
    },
  });
  if (!project) return null;
  return serializeProject(project);
}

function serializeProject(project: any) {
  return {
    id: project.id,
    title: project.title,
    researchQuestion: project.researchQuestion,
    notes: project.notes,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    papers: project.papers.map(serializePaper),
    citations: project.citations.map((c: any) => ({
      id: c.id,
      sourcePaperId: c.sourcePaperId,
      targetPaperId: c.targetPaperId,
      targetTitle: c.targetTitle,
      context: c.context,
    })),
    review: project.review
      ? {
          id: project.review.id,
          content: project.review.content,
          status: project.review.status,
          error: project.review.error,
          generatedAt: project.review.generatedAt?.toISOString() ?? null,
          updatedAt: project.review.updatedAt.toISOString(),
        }
      : null,
  };
}

function serializePaper(p: any) {
  let authors: string[] = [];
  try {
    authors = JSON.parse(p.authors) as string[];
  } catch {
    authors = [];
  }
  let keyConcepts: PaperConcept[] = [];
  try {
    keyConcepts = JSON.parse(p.keyConcepts) as PaperConcept[];
  } catch {
    keyConcepts = [];
  }
  return {
    id: p.id,
    projectId: p.projectId,
    title: p.title,
    authors,
    year: p.year,
    venue: p.venue,
    doi: p.doi,
    url: p.url,
    sourceType: p.sourceType,
    fileId: p.fileId,
    abstract: p.abstract,
    fullText: p.fullText,
    status: p.status,
    annotations: p.annotations,
    keyConcepts,
    extracted: p.extracted,
    extractStatus: p.extractStatus,
    extractError: p.extractError,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function createProject(
  userId: string,
  data: { title: string; researchQuestion?: string }
) {
  const project = await prisma.compassProject.create({
    data: {
      userId,
      title: data.title.trim(),
      researchQuestion: data.researchQuestion?.trim() ?? "",
    },
  });
  return { id: project.id, title: project.title };
}

export async function updateProject(
  userId: string,
  projectId: string,
  data: { title?: string; researchQuestion?: string; notes?: string }
) {
  // Verify ownership before updating.
  const owned = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!owned) throw new Error("Project not found");
  const update: any = {};
  if (data.title !== undefined) update.title = data.title.trim();
  if (data.researchQuestion !== undefined) update.researchQuestion = data.researchQuestion;
  if (data.notes !== undefined) update.notes = data.notes;
  const project = await prisma.compassProject.update({
    where: { id: projectId },
    data: update,
  });
  return { id: project.id, title: project.title };
}

export async function deleteProject(userId: string, projectId: string) {
  await prisma.compassProject.deleteMany({ where: { id: projectId, userId } });
}

// ----- paper ingestion -----

export async function addPaper(
  userId: string,
  projectId: string,
  input: {
    sourceType: "file" | "url" | "manual";
    fileId?: string;
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    doi?: string;
  }
): Promise<{ id: string; title: string; abstract: string; fullText: string }> {
  // Verify project ownership.
  const project = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw new Error("Project not found");

  let title = input.title?.trim() ?? "";
  let abstract = "";
  let fullText = "";
  let url = input.url?.trim() ?? "";

  if (input.sourceType === "file" && input.fileId) {
    const file = await prisma.vFile.findFirst({
      where: { id: input.fileId, userId },
    });
    if (!file) throw new Error("File not found");
    if (!title) title = file.name.replace(/\.[^.]+$/, "");
    // Extract text from the file.
    if (isPdfFile(file.name, file.mimeType)) {
      if (file.storageKey) {
        const absPath = path.join(UPLOAD_DIR, file.storageKey);
        const buf = await readFile(absPath);
        fullText = await extractPdfText(buf);
      }
    } else {
      // Text file — read directly.
      if (file.storageKey) {
        const absPath = path.join(UPLOAD_DIR, file.storageKey);
        const buf = await readFile(absPath);
        fullText = buf.toString("utf-8");
      }
    }
    fullText = truncatePaper(fullText);
    // Try to extract an abstract from the first ~500 chars.
    abstract = extractAbstract(fullText);
  } else if (input.sourceType === "url" && input.url) {
    const page = await fetchUrl(input.url, MAX_PAPER_CHARS);
    fullText = truncatePaper(page.content);
    if (!title) title = page.title;
    abstract = extractAbstract(fullText);
  }

  const paper = await prisma.compassPaper.create({
    data: {
      projectId,
      userId,
      title: title || "Untitled",
      authors: JSON.stringify(input.authors ?? []),
      year: input.year ?? null,
      venue: input.venue ?? "",
      doi: input.doi ?? "",
      url,
      sourceType: input.sourceType,
      fileId: input.fileId ?? null,
      abstract,
      fullText,
    },
  });
  return { id: paper.id, title: paper.title, abstract, fullText };
}

/** Heuristic abstract extraction: look for an "Abstract" heading and grab
 *  the text until the next section heading or ~2000 chars. */
function extractAbstract(text: string): string {
  if (!text) return "";
  // Try to find "Abstract" heading (case-insensitive).
  const match = text.match(/(?:^|\n)\s*(?:Abstract|ABSTRACT)\s*[:\n]+([\s\S]{50,2000}?)(?:\n\s*(?:Introduction|Keywords|Index Terms|1\.|I\.|Background|Related Work|1 Introduction))/i);
  if (match) return match[1].trim().slice(0, 2000);
  // Fallback: first 1000 chars of the text.
  return text.slice(0, 1000).trim();
}

export async function updatePaper(
  userId: string,
  paperId: string,
  data: {
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    doi?: string;
    url?: string;
    status?: string;
    annotations?: string;
  }
) {
  // Verify ownership before updating (matches deletePaper's pattern).
  const owned = await prisma.compassPaper.findFirst({
    where: { id: paperId, userId },
    select: { id: true },
  });
  if (!owned) throw new Error("Paper not found");
  const update: any = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.authors !== undefined) update.authors = JSON.stringify(data.authors);
  if (data.year !== undefined) update.year = data.year;
  if (data.venue !== undefined) update.venue = data.venue;
  if (data.doi !== undefined) update.doi = data.doi;
  if (data.url !== undefined) update.url = data.url;
  if (data.status !== undefined) {
    if (!["to_read", "reading", "read"].includes(data.status)) {
      throw new Error("Invalid status");
    }
    update.status = data.status;
  }
  if (data.annotations !== undefined) update.annotations = data.annotations;
  const paper = await prisma.compassPaper.update({
    where: { id: paperId },
    data: update,
  });
  return serializePaper(paper);
}

export async function deletePaper(userId: string, paperId: string) {
  // Verify ownership before deleting.
  const paper = await prisma.compassPaper.findFirst({
    where: { id: paperId, userId },
  });
  if (!paper) throw new Error("Paper not found");
  await prisma.compassPaper.delete({ where: { id: paperId } });
}

// ----- LLM extraction (concepts + citations) -----

export async function startPaperExtraction(
  userId: string,
  paperId: string,
  model: LlmModel
): Promise<{ id: string; extractStatus: string }> {
  const paper = await prisma.compassPaper.findFirst({
    where: { id: paperId, userId },
  });
  if (!paper) throw new Error("Paper not found");
  if (!paper.fullText || paper.fullText.trim().length < 100) {
    throw new Error("Paper has no extractable text. Add a PDF or URL source.");
  }

  // Reserve as "extracting".
  await prisma.compassPaper.update({
    where: { id: paperId },
    data: { extractStatus: "extracting", extractError: "" },
  });

  // Fire-and-forget extraction.
  void extractPaperData(userId, paperId, model, paper.title, paper.fullText)
    .catch((e) =>
      prisma.compassPaper.update({
        where: { id: paperId },
        data: {
          extractStatus: "error",
          extractError: e instanceof Error ? e.message : "Extraction failed",
        },
      })
    );

  return { id: paperId, extractStatus: "extracting" };
}

async function extractPaperData(
  userId: string,
  paperId: string,
  model: LlmModel,
  title: string,
  fullText: string
): Promise<void> {
  const prompt = `You are a research assistant analyzing an academic paper. Extract the key concepts and citation references from the following paper.

Paper title: ${title}

Paper text (possibly truncated):
---
${fullText}
---

Extract:
1. **Key concepts**: 5-15 important concepts/terms discussed in the paper. For each, provide a label, type (concept/term/method/dataset/metric/other), and a 1-sentence definition.
2. **Citations**: References to other works cited in the paper. For each, provide the title of the cited work (as it appears in the text or reference list) and the sentence where the citation appears (the context). Only include citations where you can identify a title — skip generic citations like "et al." without a title.
3. **Abstract**: If the paper has an explicit abstract, extract it. Otherwise, write a 2-3 sentence summary.

Respond with a JSON object.`;

  const schemaHint =
    'Schema: { "abstract": string, "concepts": [ { "label": string, "type": string, "definition": string } ], "citations": [ { "targetTitle": string, "context": string } ] }';

  const result = await generateJson<PaperExtractionResult>(model, prompt, schemaHint);

  const concepts = (result.concepts ?? []).slice(0, 20);
  const citations = (result.citations ?? []).slice(0, 50);
  const abstract = result.abstract ?? "";

  // Save extraction results.
  await prisma.compassPaper.update({
    where: { id: paperId },
    data: {
      keyConcepts: JSON.stringify(concepts),
      extracted: true,
      extractStatus: "done",
      extractError: "",
      abstract: abstract || undefined,
    },
  });

  // Save citation edges. Try to match cited titles to existing papers in
  // the same project (case-insensitive).
  const paper = await prisma.compassPaper.findUnique({
    where: { id: paperId },
    select: { projectId: true },
  });
  if (!paper) return;

  const existingPapers = await prisma.compassPaper.findMany({
    where: { projectId: paper.projectId, id: { not: paperId } },
    select: { id: true, title: true },
  });

  // Delete old citations from this paper (re-extraction replaces them).
  await prisma.compassCitation.deleteMany({
    where: { sourcePaperId: paperId },
  });

  for (const cite of citations) {
    const targetTitle = cite.targetTitle.trim();
    if (!targetTitle) continue;
    // Try to match to an existing paper in the corpus.
    const match = existingPapers.find(
      (p) => p.title.toLowerCase().includes(targetTitle.toLowerCase()) ||
            targetTitle.toLowerCase().includes(p.title.toLowerCase())
    );
    await prisma.compassCitation.create({
      data: {
        projectId: paper.projectId,
        userId,
        sourcePaperId: paperId,
        targetPaperId: match?.id ?? null,
        targetTitle,
        context: cite.context.slice(0, 500),
      },
    });
  }
}

// ----- related-work search -----

export async function searchRelatedWork(
  userId: string,
  projectId: string,
  query: string
) {
  // Verify project ownership.
  const project = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw new Error("Project not found");

  // Enrich the query with the research question + key concepts from the
  // corpus, so results are more targeted.
  const papers = await prisma.compassPaper.findMany({
    where: { projectId },
    select: { title: true, keyConcepts: true },
  });
  const conceptLabels: string[] = [];
  for (const p of papers) {
    try {
      const concepts = JSON.parse(p.keyConcepts) as PaperConcept[];
      for (const c of concepts) conceptLabels.push(c.label);
    } catch {
      // skip
    }
  }
  const existingTitles = new Set(papers.map((p) => p.title.toLowerCase()));

  // Build a search query that combines the user query with the research
  // question and a few key concepts.
  const enrichedQuery = [
    query.trim(),
    project.researchQuestion ? `(${project.researchQuestion})` : "",
    conceptLabels.slice(0, 3).map((c) => `"${c}"`).join(" "),
  ].filter(Boolean).join(" ");

  const searchRes = await webSearch(enrichedQuery, { count: 10 });
  // Mark results that are already in the corpus.
  const results = searchRes.results.map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
    inCorpus: existingTitles.has(r.title.toLowerCase()),
  }));
  return { query: enrichedQuery, results, backend: searchRes.backend };
}

// ----- reading-gap analysis -----

export interface ReadingGaps {
  yearDistribution: { year: number; count: number }[];
  gaps: { kind: "recency" | "coverage" | "citation_balance"; description: string; severity: "info" | "warning" }[];
  unreadCount: number;
  readCount: number;
  totalCount: number;
  unextractedCount: number;
}

export async function analyzeReadingGaps(
  userId: string,
  projectId: string
): Promise<ReadingGaps> {
  const project = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
    include: {
      papers: { select: { id: true, title: true, year: true, status: true, extracted: true, keyConcepts: true } },
      citations: { select: { sourcePaperId: true, targetPaperId: true, targetTitle: true } },
    },
  });
  if (!project) throw new Error("Project not found");

  const papers = project.papers;
  const gaps: ReadingGaps["gaps"] = [];

  // Year distribution.
  const yearMap = new Map<number, number>();
  for (const p of papers) {
    if (p.year) yearMap.set(p.year, (yearMap.get(p.year) ?? 0) + 1);
  }
  const yearDistribution = [...yearMap.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  // Recency gap: if >60% of papers are older than 3 years.
  const currentYear = new Date().getFullYear();
  const oldPapers = papers.filter((p) => p.year && p.year < currentYear - 3);
  if (papers.length > 0 && oldPapers.length / papers.length > 0.6) {
    gaps.push({
      kind: "recency",
      description: `Your corpus leans on older sources — ${oldPapers.length} of ${papers.length} papers are from before ${currentYear - 3}. Consider adding recent work to capture the state of the art.`,
      severity: "warning",
    });
  }

  // Coverage gap: papers not yet extracted.
  const unextracted = papers.filter((p) => !p.extracted);
  if (unextracted.length > 0) {
    gaps.push({
      kind: "coverage",
      description: `${unextracted.length} paper${unextracted.length !== 1 ? "s" : ""} haven't been analyzed yet. Run extraction to build the citation graph and concept map.`,
      severity: "info",
    });
  }

  // Citation balance: find heavily-cited titles (in the corpus) that are
  // NOT in the corpus themselves — these are works the user references but
  // hasn't read.
  const citedTitles = new Map<string, number>();
  for (const c of project.citations) {
    if (!c.targetPaperId) {
      const key = c.targetTitle.toLowerCase();
      citedTitles.set(key, (citedTitles.get(key) ?? 0) + 1);
    }
  }
  const heavilyCited = [...citedTitles.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (heavilyCited.length > 0) {
    const titles = heavilyCited.map(([t, c]) => `"${t}" (${c}x)`).join(", ");
    gaps.push({
      kind: "citation_balance",
      description: `These frequently-cited works aren't in your corpus yet: ${titles}. Consider adding them to ensure you've read what you cite.`,
      severity: "warning",
    });
  }

  return {
    yearDistribution,
    gaps,
    unreadCount: papers.filter((p) => p.status === "to_read").length,
    readCount: papers.filter((p) => p.status === "read").length,
    totalCount: papers.length,
    unextractedCount: unextracted.length,
  };
}

// ----- literature review draft (fire-and-forget + polling) -----

export async function getReviewStatus(userId: string, projectId: string) {
  // Verify the project belongs to the user before returning its review.
  const project = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) return null;
  const review = await prisma.compassReview.findUnique({
    where: { projectId },
  });
  if (!review) return null;
  return {
    id: review.id,
    projectId: review.projectId,
    content: review.content,
    status: review.status,
    error: review.error,
    generatedAt: review.generatedAt?.toISOString() ?? null,
    updatedAt: review.updatedAt.toISOString(),
  };
}

export async function startGenerateReview(
  userId: string,
  projectId: string,
  model: LlmModel
): Promise<{ id: string; status: string }> {
  const project = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
    include: {
      papers: { select: { id: true, title: true, authors: true, year: true, venue: true, abstract: true, keyConcepts: true, status: true } },
      citations: { select: { sourcePaperId: true, targetPaperId: true, targetTitle: true, context: true } },
    },
  });
  if (!project) throw new Error("Project not found");
  if (project.papers.length === 0) {
    throw new Error("Add at least one paper before generating a literature review.");
  }

  // Upsert review row to "building".
  const existing = await prisma.compassReview.findUnique({
    where: { projectId },
  });
  const reservation = { content: "", status: "building", error: "" };
  const row = existing
    ? await prisma.compassReview.update({ where: { id: existing.id }, data: reservation })
    : await prisma.compassReview.create({ data: { projectId, ...reservation } });

  // Fire-and-forget generation.
  void generateReviewContent(userId, projectId, model, project)
    .then((content) =>
      prisma.compassReview.update({
        where: { id: row.id },
        data: {
          content,
          status: "ready",
          error: "",
          generatedAt: new Date(),
        },
      })
    )
    .catch((e) =>
      prisma.compassReview
        .update({
          where: { id: row.id },
          data: {
            status: "error",
            error: e instanceof Error ? e.message : "Review generation failed",
          },
        })
        .catch(() => {})
    );

  return { id: row.id, status: "building" };
}

async function generateReviewContent(
  userId: string,
  projectId: string,
  model: LlmModel,
  project: any
): Promise<string> {
  // Build a structured prompt with the research question, paper summaries,
  // concepts, and citation graph.
  const paperSummaries = project.papers.map((p: any, i: number) => {
    let authors: string[] = [];
    try {
      authors = JSON.parse(p.authors) as string[];
    } catch {
      authors = [];
    }
    let concepts: PaperConcept[] = [];
    try {
      concepts = JSON.parse(p.keyConcepts) as PaperConcept[];
    } catch {
      concepts = [];
    }
    const conceptList = concepts.slice(0, 5).map((c) => c.label).join(", ");
    return `[${i + 1}] ${p.title}${authors.length > 0 ? ` — ${authors.join(", ")}` : ""}${p.year ? ` (${p.year})` : ""}${p.venue ? `, ${p.venue}` : ""}
   Abstract: ${p.abstract || "(no abstract available)"}
   Key concepts: ${conceptList || "(not extracted)"}`;
  }).join("\n\n");

  // Build citation graph summary.
  const paperById = new Map(project.papers.map((p: any) => [p.id, p.title]));
  const citationLines = project.citations.map((c: any) => {
    const source = paperById.get(c.sourcePaperId) ?? "Unknown";
    const target = c.targetPaperId ? paperById.get(c.targetPaperId) : c.targetTitle;
    return `- "${source}" cites "${target}"${c.context ? `: ${c.context.slice(0, 150)}` : ""}`;
  }).join("\n");

  const prompt = `You are a research assistant helping a student write a literature review. Draft a structured literature review in Markdown based on the following research project.

**Research question:** ${project.researchQuestion || "(not specified)"}

**Project title:** ${project.title}

**Papers in the corpus:**
${paperSummaries}

**Citation graph:**
${citationLines || "(no citations extracted yet)"}

Write a literature review that:
1. Opens with an introduction framing the research question and the scope of the review.
2. Groups the papers thematically (not just paper-by-paper). Identify 2-4 themes/threads that emerge from the corpus.
3. Within each theme, synthesize what the papers say, noting agreements, disagreements, and gaps. Use inline citations in [Author, Year] or [n] format referencing the paper list above.
4. Discuss the citation graph: which works are foundational (heavily cited), which build on which, and where the graph is sparse.
5. Identifies reading gaps: what's missing from the corpus? What recent work should be added? What perspectives are underrepresented?
6. Concludes with a summary of the state of the field and the most promising directions for the student's own research.

Use proper academic Markdown with ## headings, bullet points where appropriate, and inline citations. The review should be 800-2000 words.`;

  const content = await generateText(
    model,
    prompt,
    "You are a research assistant. Write a clear, well-structured academic literature review in Markdown. Use inline citations referencing the papers provided."
  );
  return content;
}

export async function updateReviewContent(
  userId: string,
  projectId: string,
  content: string
) {
  // Verify the project belongs to the user before writing its review.
  const project = await prisma.compassProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw new Error("Project not found");
  const review = await prisma.compassReview.findUnique({
    where: { projectId },
  });
  if (!review) {
    const created = await prisma.compassReview.create({
      data: { projectId, content, status: "ready" },
    });
    return { id: created.id, content: created.content };
  }
  const updated = await prisma.compassReview.update({
    where: { id: review.id },
    data: { content, status: "ready", error: "" },
  });
  return { id: updated.id, content: updated.content };
}
