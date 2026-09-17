import type { AppId } from "../store/windows";
import { useLanguage } from "../store/language";
import type { AppLanguage } from "../services/settings";

const messages = {
  en: {
    loading: "Loading...",
    settings: "Settings",
    settingsSubtitle: "Account & preferences",
    languageRegion: "Language & Region",
    applicationLanguage: "Application language",
    languageDescription: "Choose the language used by the interface, Mavino, and generated content.",
    sourceLanguageHint: "Source documents do not change the selected output language.",
    appOverrides: "Application overrides",
    overrideDescription: "Overrides stay active until switched back to the global language.",
    resetAll: "Reset all",
    resetAppOverrides: "Reset app overrides",
    useGlobal: "Use global",
    appearance: "Appearance",
    wallpaper: "Wallpaper",
    shortcuts: "Shortcuts",
    account: "Account",
    dateTime: "Date & Time",
    integrations: "Integrations",
    notifications: "Notifications",
    about: "About",
    english: "English",
    czech: "Čeština",
    studyHub: "Study Hub",
    podcasts: "Podcasts",
    teachMe: "Teach Me",
    lectureNotes: "Lecture Notes",
    intelligentUpload: "Intelligent Upload",
  },
  cs: {
    loading: "Načítání...",
    settings: "Nastavení",
    settingsSubtitle: "Účet a předvolby",
    languageRegion: "Jazyk a oblast",
    applicationLanguage: "Jazyk aplikace",
    languageDescription: "Zvolte jazyk rozhraní, Mavina a generovaného obsahu.",
    sourceLanguageHint: "Jazyk zdrojových dokumentů nemění vybraný jazyk výstupu.",
    appOverrides: "Nastavení jednotlivých aplikací",
    overrideDescription: "Vlastní volba zůstane aktivní, dokud aplikaci nepřepnete zpět na globální jazyk.",
    resetAll: "Obnovit vše",
    resetAppOverrides: "Obnovit jazyky aplikací",
    useGlobal: "Použít globální jazyk",
    appearance: "Vzhled",
    wallpaper: "Tapeta",
    shortcuts: "Klávesové zkratky",
    account: "Účet",
    dateTime: "Datum a čas",
    integrations: "Integrace",
    notifications: "Oznámení",
    about: "O aplikaci",
    english: "Angličtina",
    czech: "Čeština",
    studyHub: "Studijní centrum",
    podcasts: "Podcasty",
    teachMe: "Výuka",
    lectureNotes: "Poznámky z přednášky",
    intelligentUpload: "Chytré nahrávání",
  },
} as const;

export type MessageKey = keyof typeof messages.en;

const appNames: Partial<Record<AppId, [string, string]>> = {
  notes: ["Notes", "Poznámky"],
  tasks: ["Tasks", "Úkoly"],
  files: ["Files", "Soubory"],
  whiteboard: ["Whiteboard", "Tabule"],
  study: ["Study Hub", "Studijní centrum"],
  athena: ["Mavino", "Mavino"],
  today: ["Today", "Dnes"],
  settings: ["Settings", "Nastavení"],
  plans: ["Plans", "Plány"],
  editor: ["Editor", "Editor"],
  viewer: ["Viewer", "Prohlížeč"],
  pomodoro: ["Pomodoro", "Pomodoro"],
  flashcards: ["Flashcards", "Kartičky"],
  calendar: ["Calendar", "Kalendář"],
  habits: ["Habits", "Návyky"],
  browser: ["Browser", "Prohlížeč webu"],
  reminders: ["Reminders", "Připomínky"],
  analytics: ["Analytics", "Analytika"],
  maps: ["Maps", "Mapy"],
  marketplace: ["Marketplace", "Tržiště"],
};

export function translate(language: AppLanguage, key: MessageKey): string {
  return messages[language][key] ?? messages.en[key];
}

export function translateAppName(id: AppId, fallback: string, language: AppLanguage): string {
  const names = appNames[id];
  return names ? names[language === "cs" ? 1 : 0] : fallback;
}

export function useI18n() {
  const language = useLanguage((state) => state.language);
  return {
    language,
    locale: language === "cs" ? "cs-CZ" : "en-US",
    t: (key: MessageKey) => translate(language, key),
    appName: (id: AppId, fallback: string) => translateAppName(id, fallback, language),
  };
}
