import { create } from "zustand";
import { settingsApi, type AppLanguage } from "../services/settings";

export type LanguagePreference = "global" | AppLanguage;
export type LanguageScope = "study" | "podcast" | "teach" | "echo" | "lecture" | "intelligent-upload";

const LANGUAGE_KEY = "athena.language";
const OVERRIDES_KEY = "athena.language-overrides";
const LEGACY_STUDY_KEY = "study-language";
const scopes: LanguageScope[] = ["study", "podcast", "teach", "echo", "lecture", "intelligent-upload"];

function validLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "cs";
}

function loadLanguage(): AppLanguage {
  const value = localStorage.getItem(LANGUAGE_KEY);
  return validLanguage(value) ? value : "en";
}

function loadOverrides(): Record<LanguageScope, LanguagePreference> {
  const defaults = Object.fromEntries(scopes.map((scope) => [scope, "global"])) as Record<LanguageScope, LanguagePreference>;
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}") as Partial<Record<LanguageScope, LanguagePreference>>;
    for (const scope of scopes) {
      const value = parsed[scope];
      if (value === "global" || validLanguage(value)) defaults[scope] = value;
    }
  } catch {}
  const legacy = localStorage.getItem(LEGACY_STUDY_KEY);
  if (!localStorage.getItem(OVERRIDES_KEY) && validLanguage(legacy)) defaults.study = legacy;
  localStorage.removeItem(LEGACY_STUDY_KEY);
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(defaults));
  return defaults;
}

function applyLanguage(language: AppLanguage) {
  document.documentElement.lang = language;
  localStorage.setItem(LANGUAGE_KEY, language);
}

interface LanguageState {
  language: AppLanguage;
  loaded: boolean;
  overrides: Record<LanguageScope, LanguagePreference>;
  load: () => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setOverride: (scope: LanguageScope, preference: LanguagePreference) => void;
  resetOverrides: () => void;
  effectiveLanguage: (scope: LanguageScope) => AppLanguage;
}

const initialLanguage = loadLanguage();
applyLanguage(initialLanguage);

export const useLanguage = create<LanguageState>((set, get) => ({
  language: initialLanguage,
  loaded: false,
  overrides: loadOverrides(),
  load: async () => {
    try {
      const { language } = await settingsApi.getLanguage();
      applyLanguage(language);
      set({ language, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setLanguage: async (language) => {
    const previous = get().language;
    applyLanguage(language);
    set({ language });
    try {
      await settingsApi.setLanguage(language);
    } catch (error) {
      applyLanguage(previous);
      set({ language: previous });
      throw error;
    }
  },
  setOverride: (scope, preference) => {
    const overrides = { ...get().overrides, [scope]: preference };
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    set({ overrides });
  },
  resetOverrides: () => {
    const overrides = Object.fromEntries(scopes.map((scope) => [scope, "global"])) as Record<LanguageScope, LanguagePreference>;
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    set({ overrides });
  },
  effectiveLanguage: (scope) => {
    const preference = get().overrides[scope];
    return preference === "global" ? get().language : preference;
  },
}));
