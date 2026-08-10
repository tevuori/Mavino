// ===== Study Hub function gating =====
// Admins can enable/disable each Study Hub AI function per tier (FREE / PAID).
// ADMIN and MANAGER users always have access to all functions.

import prisma from "../db/client";

export interface StudyFunctionDef {
  id: string;
  label: string;
  description: string;
}

/** Canonical list of Study Hub functions that can be toggled per tier. */
export const STUDY_HUB_FUNCTIONS: StudyFunctionDef[] = [
  { id: "chat", label: "Ask (grounded)", description: "Source-grounded Q&A with citations." },
  { id: "teach", label: "Teach Me", description: "Interactive live tutoring from sources." },
  { id: "podcast", label: "Podcast", description: "AI-generated 2-host audio script from sources." },
  { id: "graph", label: "Knowledge Graph", description: "Extract concepts and relationships from sources." },
  { id: "lecture", label: "Lecture → Notes", description: "Generate notes from lecture videos." },
  { id: "flashcards", label: "Generate Flashcards", description: "AI Q/A cards from a source." },
  { id: "summarize", label: "Summarize", description: "TL;DR, outline, or key points from a source." },
  { id: "explain", label: "Explain", description: "Explain a concept at any depth." },
  { id: "study_guide", label: "Study Guide", description: "Consolidate sources into a cheat sheet." },
  { id: "quiz", label: "Quiz Me", description: "AI-graded quiz from sources." },
  { id: "syllabus", label: "Syllabus → Tasks", description: "Extract tasks from a syllabus." },
  { id: "notes_from_source", label: "Notes from source", description: "Generate structured notes from a source." },
];

export const STUDY_FUNCTION_IDS = new Set(STUDY_HUB_FUNCTIONS.map((f) => f.id));

export interface StudyFunctionTierConfig {
  free: boolean;
  paid: boolean;
  pro: boolean;
}

export type StudyFunctionConfig = Record<string, StudyFunctionTierConfig>;

const CONFIG_KEY = "study.functions";

function defaultConfig(): StudyFunctionConfig {
  const out: StudyFunctionConfig = {};
  for (const f of STUDY_HUB_FUNCTIONS) {
    out[f.id] = { free: true, paid: true, pro: true };
  }
  return out;
}

function safeParseConfig(raw: string | null): StudyFunctionConfig {
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return defaultConfig();
    const out: StudyFunctionConfig = {};
    for (const f of STUDY_HUB_FUNCTIONS) {
      const val = (parsed as Record<string, unknown>)[f.id];
      if (val && typeof val === "object") {
        const free = Boolean((val as Record<string, unknown>).free);
        const paid = Boolean((val as Record<string, unknown>).paid);
        const pro = (val as Record<string, unknown>).pro !== undefined
          ? Boolean((val as Record<string, unknown>).pro)
          : paid; // back-compat: if pro not stored, inherit paid value
        out[f.id] = { free, paid, pro };
      } else {
        out[f.id] = { free: true, paid: true, pro: true };
      }
    }
    return out;
  } catch {
    return defaultConfig();
  }
}

/** Load the global Study Hub function config. */
export async function getStudyFunctionConfig(): Promise<StudyFunctionConfig> {
  const s = await prisma.setting.findFirst({ where: { userId: null, key: CONFIG_KEY } });
  return safeParseConfig(s?.value ?? null);
}

/** Save the global Study Hub function config. */
export async function setStudyFunctionConfig(config: StudyFunctionConfig): Promise<StudyFunctionConfig> {
  // Normalize: keep only known function ids and ensure booleans.
  const normalized: StudyFunctionConfig = {};
  for (const f of STUDY_HUB_FUNCTIONS) {
    const val = config[f.id] ?? { free: true, paid: true, pro: true };
    normalized[f.id] = {
      free: Boolean(val.free),
      paid: Boolean(val.paid),
      pro: Boolean(val.pro),
    };
  }
  const value = JSON.stringify(normalized);
  const existing = await prisma.setting.findFirst({ where: { userId: null, key: CONFIG_KEY } });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key: CONFIG_KEY, value } });
  }
  return normalized;
}

/** Get the user's role from the DB. */
async function getUserRole(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role ?? null;
}

/** Whether a Study Hub function is enabled for the given user. */
export async function isStudyFunctionEnabled(userId: string, functionId: string): Promise<boolean> {
  if (!STUDY_FUNCTION_IDS.has(functionId)) return true;
  const role = await getUserRole(userId);
  if (role === "ADMIN" || role === "MANAGER" || role === "DEMO") return true;
  const config = await getStudyFunctionConfig();
  const cfg = config[functionId] ?? { free: true, paid: true, pro: true };
  if (role === "PRO") return cfg.pro;
  if (role === "PAID") return cfg.paid;
  return cfg.free;
}

/** List the Study Hub function ids enabled for the given user. */
export async function getEnabledStudyFunctionIds(userId: string): Promise<string[]> {
  const role = await getUserRole(userId);
  if (role === "ADMIN" || role === "MANAGER" || role === "DEMO") {
    return Array.from(STUDY_FUNCTION_IDS);
  }
  const config = await getStudyFunctionConfig();
  return STUDY_HUB_FUNCTIONS.filter((f) => {
    const cfg = config[f.id] ?? { free: true, paid: true, pro: true };
    if (role === "PRO") return cfg.pro;
    if (role === "PAID") return cfg.paid;
    return cfg.free;
  }).map((f) => f.id);
}
