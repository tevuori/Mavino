import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles, StickyNote, CheckSquare, Calendar, Settings as SettingsIcon,
  Palette, Plug, ArrowRight, ArrowLeft, X, Check, Lightbulb,
  Keyboard, Music, GraduationCap, Brain, Folder, Timer, Flame, PenTool, Mic, Globe, UserRound,
  Loader2, ExternalLink, ShieldAlert, KeyRound,
} from "lucide-react";
import { useWindows } from "../store/windows";
import { useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import { isAppAvailable } from "../store/features";
import { APP_MAP } from "../apps/registry";
import { aiApi } from "../services/ai";

// ===== Onboarding step definitions =====

interface StepDef {
  id: string;
  /** Whether this step shows a centered modal (true) or a bottom panel (false). */
  centered?: boolean;
  /** Use a wider modal (for screenshot-heavy steps). */
  wide?: boolean;
  /** Optional: open an app window when this step becomes active. The window is
   * always centered on screen and closed automatically when the user leaves
   * this step (Next/Back/Skip/Finish). */
  openApp?: { appId: string; section?: string; size: { width: number; height: number } };
}

const GEMINI_KEYS_URL = "https://aistudio.google.com/api-keys";

const STEPS: StepDef[] = [
  { id: "welcome", centered: true },
  { id: "name", centered: true },
  { id: "desktop", centered: true },
  { id: "notes", openApp: { appId: "notes", size: { width: 720, height: 480 } } },
  { id: "tasks", openApp: { appId: "tasks", size: { width: 760, height: 460 } } },
  { id: "athena", openApp: { appId: "athena", size: { width: 680, height: 520 } } },
  { id: "calendar", openApp: { appId: "calendar", size: { width: 820, height: 520 } } },
  { id: "more-apps", centered: true },
  { id: "llm-intro", centered: true },
  { id: "gemini-1", centered: true, wide: true },
  { id: "gemini-2", centered: true, wide: true },
  { id: "gemini-3", centered: true, wide: true },
  { id: "gemini-4", centered: true, wide: true },
  { id: "gemini-5", centered: true, wide: true },
  { id: "gemini-save", centered: true },
  { id: "appearance", openApp: { appId: "settings", section: "appearance", size: { width: 760, height: 560 } } },
  { id: "integrations", openApp: { appId: "settings", section: "integrations", size: { width: 760, height: 560 } } },
  { id: "shortcuts", centered: true },
  { id: "complete", centered: true },
];

const TASKBAR_HEIGHT = 0; // bottom bar auto-hides, so full viewport is usable

/** Computes a rect that centers a window of the given size on the current viewport. */
function centeredRect(width: number, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TASKBAR_HEIGHT;
  const w = Math.min(width, Math.max(320, vw - 20));
  const h = Math.min(height, Math.max(240, vh - 20));
  return {
    x: Math.max(0, Math.floor((vw - w) / 2)),
    y: Math.max(0, Math.floor((vh - h) / 2)),
    width: w,
    height: h,
  };
}

export default function OnboardingOverlay() {
  const [stepIdx, setStepIdx] = useState(0);
  const openWindow = useWindows((s) => s.open);
  const closeWindow = useWindows((s) => s.close);
  const setHasOnboarded = useSettings((s) => s.setHasOnboarded);
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  // "Student" is the legacy seeded placeholder — start from an empty field.
  const currentName = user?.displayName ?? "";
  const [name, setName] = useState(currentName.trim().toLowerCase() === "student" ? "" : currentName);
  // Tracks the window (if any) opened by the *current* onboarding step, so it
  // can be closed as soon as the user moves to the next/previous step. Windows
  // that already existed before the step opened them are left alone.
  const openedWindowRef = useRef<string | null>(null);
  // Ref shared with the Gemini key save step so the Next button can trigger an
  // auto-save without the step needing to be a forwardRef component.
  const geminiSaveRef = useRef<GeminiKeySaveHandle>({ saveIfNeeded: undefined });

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  /** Persist the name typed in the "name" step before leaving it. */
  const saveName = useCallback(() => {
    const trimmed = name.trim();
    if (step.id !== "name" || !trimmed || trimmed === user?.displayName) return;
    void updateProfile({ displayName: trimmed }).catch(() => {
      /* non-blocking: the user can set it later in Settings → Account */
    });
  }, [name, step.id, updateProfile, user?.displayName]);

  // Open app window when entering a step that has one (only if the app is
  // available to the user — e.g. skip opening Calendar if it's tier-gated), and
  // close whatever window the previous step opened so onboarding never
  // leaves a trail of stray windows behind. Windows always open centered.
  useEffect(() => {
    if (openedWindowRef.current) {
      closeWindow(openedWindowRef.current);
      openedWindowRef.current = null;
    }
    if (step.openApp) {
      const app = APP_MAP[step.openApp.appId as keyof typeof APP_MAP];
      if (app && isAppAvailable(app.id)) {
        const payload = step.openApp.section ? { section: step.openApp.section } : undefined;
        const alreadyOpen = useWindows
          .getState()
          .windows.some((w) => w.appId === app.id && JSON.stringify(w.payload) === JSON.stringify(payload));
        const id = openWindow({
          appId: app.id,
          title: app.name,
          icon: app.icon,
          payload,
          rect: centeredRect(step.openApp.size.width, step.openApp.size.height),
        });
        // Only track (and later auto-close) windows onboarding itself opened.
        if (id && !alreadyOpen) openedWindowRef.current = id;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  // Close any window left open by the final step once onboarding ends
  // (Finish/Skip unmounts this overlay).
  useEffect(() => {
    return () => {
      if (openedWindowRef.current) closeWindow(openedWindowRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [advancing, setAdvancing] = useState(false);

  const next = useCallback(async () => {
    if (advancing) return;
    setAdvancing(true);
    let willUnmount = false;
    try {
      saveName();
      // On the Gemini save step, auto-save if a key is pasted. If saving fails,
      // stay on this step and show the error; user can fix or clear the field.
      if (step.id === "gemini-save") {
        const ok = await geminiSaveRef.current.saveIfNeeded?.() ?? true;
        if (!ok) {
          setAdvancing(false);
          return;
        }
      }
      if (isLast) {
        willUnmount = true;
        setHasOnboarded(true);
        return;
      }
      setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
    } finally {
      // setHasOnboarded unmounts this overlay, so don't update its state after that.
      if (!willUnmount) setAdvancing(false);
    }
  }, [advancing, isLast, saveName, setHasOnboarded, step.id]);

  const back = useCallback(() => {
    saveName();
    setStepIdx((i) => Math.max(i - 1, 0));
  }, [saveName]);

  const skip = useCallback(() => {
    saveName();
    setHasOnboarded(true);
  }, [saveName, setHasOnboarded]);

  return (
    <AnimatePresence mode="wait">
      {step.centered ? (
        <CenteredModal
          key={step.id}
          stepId={step.id}
          stepIdx={stepIdx}
          totalSteps={STEPS.length}
          onNext={next}
          onBack={back}
          onSkip={skip}
          isLast={isLast}
          wide={step.wide}
          busy={advancing}
          name={name}
          onNameChange={setName}
          geminiSaveRef={geminiSaveRef}
        />
      ) : (
        <BottomPanel
          key={step.id}
          stepId={step.id}
          stepIdx={stepIdx}
          totalSteps={STEPS.length}
          onNext={next}
          onBack={back}
          onSkip={skip}
        />
      )}
    </AnimatePresence>
  );
}

// ===== Step content =====

function StepContent({ stepId, name, onNameChange, onSubmitName, geminiSaveRef }: {
  stepId: string;
  name?: string;
  onNameChange?: (value: string) => void;
  onSubmitName?: () => void;
  geminiSaveRef?: React.MutableRefObject<GeminiKeySaveHandle>;
}) {
  const user = useAuth((s) => s.user);
  switch (stepId) {
    case "welcome":
      return <WelcomeStep />;
    case "name":
      return <NameStep value={name ?? ""} onChange={onNameChange ?? (() => {})} onSubmit={onSubmitName ?? (() => {})} />;
    case "desktop":
      return <DesktopStep />;
    case "notes":
      return <TourStep
        icon={<StickyNote size={20} />}
        title="Notes"
        description="A Markdown editor with live preview, full LaTeX math support, folders, tags, and auto-save. Export to Markdown or PDF. Write notes, lecture summaries, or study guides."
        tips={["Type $...$ for inline math, $$...$$ for display math", "Ctrl+S to save, auto-saves as you type", "Organize with folders and tags"]}
      />;
    case "tasks":
      return <TourStep
        icon={<CheckSquare size={20} />}
        title="Tasks"
        description="A Kanban board (To Do / In Progress / Done) with drag-and-drop, priority tags, and due dates. Mavino can create tasks for you automatically."
        tips={["Drag cards between columns", "Set priorities and due dates", "Mavino AI can create tasks via chat"]}
      />;
    case "athena":
      return <TourStep
        icon={<Sparkles size={20} />}
        title="Mavino — Your AI Assistant"
        description="Chat with Mavino to get help with your studies. It can read your notes, create tasks, run code, search the web, manage your calendar, and much more. It has access to all your apps."
        tips={[
          "Ask Mavino to summarize your notes",
          ...(user && ["PAID", "MANAGER", "ADMIN"].includes(user.role)
            ? ["It can run Python/JS code in a sandbox"]
            : []),
          "It can create tasks, events, and flashcards for you",
        ]}
      />;
    case "calendar":
      return <TourStep
        icon={<Calendar size={20} />}
        title="Calendar"
        description="A full calendar with month/week/day views. Import ICS files, drag tasks to schedule them, and sync with Microsoft Outlook. Mavino can create and manage events."
        tips={["Drag tasks onto the calendar to schedule them", "Sync with Microsoft Calendar in Settings", "Import .ics files from your university"]}
      />;
    case "more-apps":
      return <MoreAppsStep />;
    case "llm-intro":
      return <GeminiIntroStep />;
    case "gemini-1":
      return <GeminiShotStep
        step={1}
        total={5}
        image="/onboarding/gemini-1.png"
        title="Sign in to Google"
        description="Open Google AI Studio and sign in with your Google account. Don't have one? You can create one for free in the same flow."
        action={{
          label: "Open Google AI Studio",
          onClick: () => window.open(GEMINI_KEYS_URL, "_blank", "noopener,noreferrer"),
        }}
      />;
    case "gemini-2":
      return <GeminiShotStep
        step={2}
        total={5}
        image="/onboarding/gemini-2.png"
        title="Accept the Terms"
        description="Google AI Studio will ask you to accept its terms. Check the required agreement box, then click Continue."
      />;
    case "gemini-3":
      return <GeminiShotStep
        step={3}
        total={5}
        image="/onboarding/gemini-3.png"
        title="Create an API Key"
        description={'On the API Keys page, click the “Create API key” button in the top-right corner.'}
      />;
    case "gemini-4":
      return <GeminiShotStep
        step={4}
        total={5}
        image="/onboarding/gemini-4.png"
        title="Name Your Key"
        description={"Give your key any name you like. If you're not sure which project to pick, just leave “Default Gemini Project” selected — then click Create key."}
      />;
    case "gemini-5":
      return <GeminiShotStep
        step={5}
        total={5}
        image="/onboarding/gemini-5.png"
        title="Copy Your Key"
        description={"Click the copy icon next to your new API key. Keep it handy — you'll paste it into Mavino on the next step."}
      />;
    case "gemini-save":
      return <GeminiKeySaveStep saveRef={geminiSaveRef ?? { current: { saveIfNeeded: undefined } }} />;
    case "appearance":
      return <SettingsGuideStep
        icon={<Palette size={20} />}
        title="Customize Your Desktop"
        section="appearance"
        description="Make Mavino yours. Choose a light or dark theme, pick an accent color, select a wallpaper, or add an animated background (starfield, matrix rain, aurora, and more)."
        tips={["Try the 14 animated backgrounds", "Your wallpaper and theme persist across sessions", "Change these anytime in Settings"]}
      />;
    case "integrations":
      return <SettingsGuideStep
        icon={<Plug size={20} />}
        title="Connect External Services"
        section="integrations"
        description="Each user configures their own integrations independently. Connect Spotify for the Music Widget, VUT Studis for grades and timetable, Microsoft Calendar for sync, and Ntfy for push notifications."
        tips={["Spotify powers the Music Widget & Chill mode", "VUT integration also enables Moodle access", "Ntfy lets Mavino send you push notifications and you can message Mavino from your phone"]}
      />;
    case "shortcuts":
      return <ShortcutsStep />;
    case "complete":
      return <CompleteStep />;
    default:
      return null;
  }
}

// ===== Individual step components =====

function WelcomeStep() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <Sparkles size={32} />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-ink">Welcome to Mavino</h2>
      <p className="mb-1 text-lg text-ink-muted">Student OS — your desktop for learning</p>
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
        A desktop-environment-style productivity dashboard with notes, tasks, an AI assistant,
        calendar, flashcards, grades tracker, and more — all in your browser.
      </p>
      <p className="mt-4 text-sm text-ink-muted">
        Let's take a quick tour and set up your workspace.
      </p>
    </div>
  );
}

function NameStep({ value, onChange, onSubmit }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <UserRound size={32} />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-ink">What should we call you?</h2>
      <p className="mx-auto max-w-sm text-sm text-ink-muted">
        Your name is used for greetings across the desktop, and Mavino will use it when talking
        to you. You can change it anytime in Settings → Account.
      </p>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        maxLength={64}
        placeholder="Your name or nickname"
        aria-label="Your name"
        className="mx-auto mt-5 block w-full max-w-xs rounded-lg border border-edge bg-surface-2 px-3 py-2 text-center text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent"
      />
      <p className="mt-3 text-xs text-ink-muted/70">Optional — skip it and Mavino will ask later.</p>
    </div>
  );
}

function DesktopStep() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <Lightbulb size={32} />
      </div>
      <h2 className="mb-3 text-xl font-bold text-ink">Your Desktop</h2>
      <div className="mx-auto max-w-md space-y-3 text-left">
        <FeatureRow icon={<Folder size={16} />} text="Double-click desktop icons to open apps" />
        <FeatureRow icon={<SettingsIcon size={16} />} text="Use the taskbar at the bottom to launch apps and check the clock" />
        <FeatureRow icon={<Keyboard size={16} />} text="Drag windows by their title bar. Snap to edges with Win+Arrow keys" />
        <FeatureRow icon={<Sparkles size={16} />} text="Press Ctrl+Space anytime for the command palette (Spotlight search)" />
      </div>
      <p className="mt-4 text-sm text-ink-muted">Now let's explore some apps...</p>
    </div>
  );
}

function TourStep({ icon, title, description, tips }: {
  icon: React.ReactNode; title: string; description: string; tips: string[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
      </div>
      <p className="mb-3 text-sm text-ink-muted">{description}</p>
      <ul className="space-y-1.5">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-ink-muted">
            <Check size={14} className="mt-0.5 shrink-0 text-accent" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-muted/70">Try it out — the window is open behind this panel.</p>
    </div>
  );
}

function MoreAppsStep() {
  const apps = [
    { icon: <Folder size={18} />, name: "Files", desc: "Virtual file system with drag-drop, ZIP, search" },
    { icon: <Brain size={18} />, name: "Flashcards", desc: "SM-2 spaced repetition with 3D flip cards" },
    { icon: <GraduationCap size={18} />, name: "Grades", desc: "GPA calculator with weighted assignments" },
    { icon: <GraduationCap size={18} />, name: "Study Hub", desc: "AI-powered flashcards, quizzes, summaries" },
    { icon: <Timer size={18} />, name: "Pomodoro", desc: "Focus timer with DND and session stats" },
    { icon: <Flame size={18} />, name: "Habits", desc: "Habit tracker with streaks and heatmap" },
    { icon: <PenTool size={18} />, name: "Whiteboard", desc: "SVG canvas with shapes, export to PNG" },
    { icon: <Mic size={18} />, name: "Voice Notes", desc: "Record + Whisper transcription → Note" },
    { icon: <Globe size={18} />, name: "Browser", desc: "In-app browser, Mavino can read pages" },
    { icon: <Music size={18} />, name: "Music Widget", desc: "Spotify player with synced lyrics + Chill mode" },
  ];
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <Sparkles size={28} />
      </div>
      <h2 className="mb-1 text-xl font-bold text-ink">And Much More</h2>
      <p className="mb-4 text-sm text-ink-muted">10+ apps to power your studies. Open them anytime from the taskbar or command palette.</p>
      <div className="grid grid-cols-2 gap-2 text-left">
        {apps.map((a) => (
          <div key={a.name} className="flex items-start gap-2 rounded-lg border border-edge bg-surface-2 p-2">
            <div className="mt-0.5 text-accent">{a.icon}</div>
            <div>
              <p className="text-xs font-medium text-ink">{a.name}</p>
              <p className="text-[11px] text-ink-muted">{a.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== Gemini API key wizard =====

function GeminiIntroStep() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <KeyRound size={32} />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-ink">Connect Mavino to an AI</h2>
      <p className="mx-auto max-w-md text-sm text-ink-muted">
        Mavino needs an LLM API key to power chat, notes, tasks, and study tools. We recommend{" "}
        <strong className="text-ink">Google Gemini</strong> — it has a generous free tier and only
        takes a minute to set up.
      </p>
      <div className="mx-auto mt-4 flex max-w-md items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-left text-xs text-amber-200">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <span>
          For your data privacy, prefer providers based outside of China (e.g. Google, OpenAI,
          Anthropic, Groq). Some China-hosted models have unclear or less protective data storage
          and retention policies.
        </span>
      </div>
      <p className="mt-4 text-sm text-ink-muted">We'll walk you through getting a free Gemini key, step by step.</p>
    </div>
  );
}

function GeminiShotStep({ step, total, image, title, description, action }: {
  step: number;
  total: number;
  image: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-xs font-bold text-accent">
          {step}/{total}
        </div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
      </div>
      <motion.div
        key={image}
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="overflow-hidden rounded-xl border border-edge bg-black/40 shadow-inner"
      >
        <img src={image} alt={title} className="block w-full" />
      </motion.div>
      <p className="mt-3 text-sm text-ink-muted">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20"
        >
          <ExternalLink size={14} /> {action.label}
        </button>
      )}
    </div>
  );
}

export interface GeminiKeySaveHandle {
  /** Saves the pasted key if one is present. Returns true if the step can advance. */
  saveIfNeeded?: (() => Promise<boolean>);
}

function GeminiKeySaveStep({ saveRef }: { saveRef: React.MutableRefObject<GeminiKeySaveHandle> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const saveIfNeeded = useCallback(async (): Promise<boolean> => {
    const trimmed = key.trim();
    if (!trimmed) return true; // user chose to skip
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await aiApi.setKey(trimmed, "google", undefined, "gemini-3.6-flash");
      setKey("");
      setMsg("Gemini API key saved — Mavino is ready to use!");
      return true;
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save the key. Double-check that you copied it correctly.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [key]);

  useEffect(() => {
    const target = saveRef.current;
    target.saveIfNeeded = saveIfNeeded;
    return () => {
      target.saveIfNeeded = undefined;
    };
  }, [saveIfNeeded, saveRef]);

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <KeyRound size={32} />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-ink">Paste Your Gemini API Key</h2>
      <p className="mx-auto max-w-sm text-sm text-ink-muted">
        Paste the key you just copied from Google AI Studio. It's encrypted (AES-256-GCM) and
        stored only on the server.
      </p>
      <div className="mx-auto mt-5 max-w-sm">
        <input
          autoFocus
          type="password"
          value={key}
          disabled={busy}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveIfNeeded();
            }
          }}
          placeholder="AIza..."
          aria-label="Gemini API key"
          autoComplete="off"
          className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-center text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
        />
      </div>
      {msg && (
        <p className={`mt-3 text-xs ${err ? "text-red-400" : "text-emerald-400"}`}>{msg}</p>
      )}
      <p className="mt-3 text-xs text-ink-muted/70">
        Press <strong>Next</strong> to save and continue, or skip and add a key later in Settings → Mavino Assistant.
      </p>
    </div>
  );
}

function SettingsGuideStep({ icon, title, section, description, tips }: {
  icon: React.ReactNode; title: string; section: string; description: string; tips: string[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
      </div>
      <p className="mb-3 text-sm text-ink-muted">{description}</p>
      <p className="mb-2 text-xs font-medium text-ink">The Settings window is open — configure it now or skip for later.</p>
      <ul className="space-y-1.5">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-ink-muted">
            <Check size={14} className="mt-0.5 shrink-0 text-accent" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShortcutsStep() {
  const shortcuts = [
    { keys: "Ctrl+Space", desc: "Command palette (search apps, notes, tasks, calculate)" },
    { keys: "Win+Y", desc: "Toggle Mavino quick panel" },
    { keys: "Ctrl+Shift+N", desc: "Quick capture — new note from anywhere" },
    { keys: "Win+← / →", desc: "Snap window to left/right half" },
    { keys: "Win+↑", desc: "Maximize window" },
    { keys: "Win+W", desc: "Close focused window" },
    { keys: "Alt+Tab", desc: "Switch between windows" },
  ];
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <Keyboard size={28} />
      </div>
      <h2 className="mb-1 text-xl font-bold text-ink">Handy Shortcuts</h2>
      <p className="mb-4 text-sm text-ink-muted">Learn these to navigate Mavino like a pro.</p>
      <div className="space-y-2 text-left">
        {shortcuts.map((s) => (
          <div key={s.keys} className="flex items-center justify-between rounded-lg border border-edge bg-surface-2 px-3 py-2">
            <span className="text-xs text-ink-muted">{s.desc}</span>
            <kbd className="rounded border border-edge bg-surface-3 px-2 py-0.5 text-[11px] font-mono text-ink">{s.keys}</kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompleteStep() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
        <Check size={32} />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-ink">You're All Set!</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
        Your workspace is ready. Start exploring — open apps from the taskbar, ask Mavino for help,
        or press Ctrl+Space to search.
      </p>
      <p className="mt-4 text-xs text-ink-muted/70">
        You can revisit settings anytime by opening the Settings app.
      </p>
    </div>
  );
}

function FeatureRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-edge bg-surface-2 px-3 py-2">
      <span className="text-accent">{icon}</span>
      <span className="text-sm text-ink-muted">{text}</span>
    </div>
  );
}

// ===== Layout wrappers =====

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === current ? "w-6 bg-accent" : i < current ? "w-1.5 bg-accent/60" : "w-1.5 bg-surface-3"
          }`}
        />
      ))}
    </div>
  );
}

function CenteredModal({ stepId, stepIdx, totalSteps, onNext, onBack, onSkip, isLast, wide, name, onNameChange, busy, geminiSaveRef }: {
  stepId: string; stepIdx: number; totalSteps: number;
  onNext: () => void | Promise<void>; onBack: () => void; onSkip: () => void; isLast: boolean; wide?: boolean;
  name?: string; onNameChange?: (value: string) => void; busy?: boolean;
  geminiSaveRef: React.MutableRefObject<GeminiKeySaveHandle>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[18000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ type: "spring", duration: 0.3 }}
        className={`relative w-full rounded-2xl border border-edge bg-surface shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}
      >
        {/* Skip button */}
        {!isLast && (
          <button
            onClick={onSkip}
            className="absolute right-3 top-3 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <X size={14} /> Skip
          </button>
        )}
        {/* Content */}
        <div className="p-8">
          <StepContent stepId={stepId} name={name} onNameChange={onNameChange} onSubmitName={onNext} geminiSaveRef={geminiSaveRef} />
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between border-t border-edge px-6 py-4">
          <ProgressBar current={stepIdx} total={totalSteps} />
          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3"
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}
            <button
              onClick={() => void onNext()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : isLast ? "Finish" : stepIdx === 0 ? "Start Tour" : "Next"}
              {!isLast && !busy && <ArrowRight size={14} />}
              {isLast && !busy && <Check size={14} />}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function BottomPanel({ stepId, stepIdx, totalSteps, onNext, onBack, onSkip }: {
  stepId: string; stepIdx: number; totalSteps: number;
  onNext: () => void | Promise<void>; onBack: () => void; onSkip: () => void;
}) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", duration: 0.3 }}
      className="fixed bottom-4 left-1/2 z-[18000] w-full max-w-md -translate-x-1/2 rounded-2xl border border-edge bg-surface/95 shadow-2xl backdrop-blur-xl"
    >
      {/* Skip button */}
      <button
        onClick={onSkip}
        className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
      >
        <X size={14} /> Skip
      </button>
      {/* Content */}
      <div className="p-5 pr-12">
        <StepContent stepId={stepId} />
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between border-t border-edge px-5 py-3">
        <ProgressBar current={stepIdx} total={totalSteps} />
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink-muted hover:bg-surface-3"
          >
            <ArrowLeft size={12} /> Back
          </button>
          <button
            onClick={() => void onNext()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
          >
            Next <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
