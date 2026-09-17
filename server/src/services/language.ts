import prisma from "../db/client";

export const APP_LANGUAGES = ["en", "cs"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

const SETTING_KEY = "language";
const DEFAULT_LANGUAGE: AppLanguage = "en";
const cache = new Map<string, AppLanguage>();

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && APP_LANGUAGES.includes(value as AppLanguage);
}

export async function getUserLanguage(userId: string): Promise<AppLanguage> {
  const cached = cache.get(userId);
  if (cached) return cached;
  const row = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: SETTING_KEY } },
  });
  const language = isAppLanguage(row?.value) ? row.value : DEFAULT_LANGUAGE;
  cache.set(userId, language);
  return language;
}

export async function setUserLanguage(userId: string, language: AppLanguage): Promise<void> {
  await prisma.setting.upsert({
    where: { userId_key: { userId, key: SETTING_KEY } },
    create: { userId, key: SETTING_KEY, value: language },
    update: { value: language },
  });
  cache.set(userId, language);
}

export function resolveAppLanguage(requested: unknown, stored: AppLanguage): AppLanguage {
  return isAppLanguage(requested) ? requested : stored;
}

export function languageName(language: AppLanguage): string {
  return language === "cs" ? "Czech (čeština)" : "English";
}

export function languageInstruction(language: AppLanguage): string {
  const name = languageName(language);
  return `Write all user-facing prose in ${name}. This includes responses, headings, labels, questions, answers, explanations, summaries, notes, feedback, and user-visible string fields in structured output. Do not infer the output language from source material. Preserve proper names, formulas, code, identifiers, enum values, schema keys, and direct quotations where appropriate.`;
}
