import { useState, useCallback, useEffect } from "react";
import {
  ArrowRight, ArrowLeft, BookOpen, Brain, CalendarDays, Check, CheckSquare,
  ChevronRight, ExternalLink, Home, KeyRound, Loader2, Monitor, MoreHorizontal,
  ShieldAlert, Sparkles, StickyNote, Timer, UserRound, X,
} from "lucide-react";
import { useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import { aiApi } from "../services/ai";
import AppLogo from "../shell/AppLogo";
import { MobileIconChip } from "./MobileUi";

const GEMINI_KEYS_URL = "https://aistudio.google.com/api-keys";
const TOTAL_STEPS = 7;

export default function MobileOnboarding() {
  const [step, setStep] = useState(0);
  const { user, updateProfile } = useAuth();
  const setHasOnboarded = useSettings((s) => s.setHasOnboarded);

  const currentName = user?.displayName ?? "";
  const [name, setName] = useState(
    currentName.trim().toLowerCase() === "student" ? "" : currentName,
  );

  // Gemini key state
  const [apiKey, setApiKey] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState(false);

  const saveName = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== user?.displayName) {
      void updateProfile({ displayName: trimmed }).catch(() => {});
    }
  }, [name, updateProfile, user?.displayName]);

  const saveKey = useCallback(async (): Promise<boolean> => {
    const trimmed = apiKey.trim();
    if (!trimmed) return true; // skipped
    setKeySaving(true);
    setKeyErr(false);
    setKeyMsg(null);
    try {
      await aiApi.setKey(trimmed, "google", undefined, "gemini-3.8-flash");
      setApiKey("");
      setKeyMsg("Gemini API key saved!");
      return true;
    } catch (e) {
      setKeyErr(true);
      setKeyMsg(
        e instanceof Error
          ? e.message
          : "Failed to save the key. Double-check that you copied it correctly.",
      );
      return false;
    } finally {
      setKeySaving(false);
    }
  }, [apiKey]);

  const [advancing, setAdvancing] = useState(false);

  const next = useCallback(async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      // Persist name when leaving the name step
      if (step === 1) saveName();
      // Save key when leaving the key step
      if (step === 3) {
        const ok = await saveKey();
        if (!ok) {
          setAdvancing(false);
          return;
        }
      }
      if (step >= TOTAL_STEPS - 1) {
        setHasOnboarded(true);
        return;
      }
      setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    } finally {
      if (step < TOTAL_STEPS - 1) setAdvancing(false);
    }
  }, [advancing, step, saveName, saveKey, setHasOnboarded]);

  const back = useCallback(() => {
    if (step === 1) saveName();
    setStep((s) => Math.max(s - 1, 0));
  }, [step, saveName]);

  const skip = useCallback(() => {
    saveName();
    setHasOnboarded(true);
  }, [saveName, setHasOnboarded]);

  return (
    <div className="fixed inset-0 z-[18000] flex flex-col bg-surface">
      {/* Decorative gradient background */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgb(var(--brand-violet)/.16),transparent_34%),radial-gradient(circle_at_100%_18%,rgb(var(--brand-cyan)/.10),transparent_28%)]" />

      {/* Top bar: progress + skip */}
      <div className="relative flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <ProgressDots current={step} total={TOTAL_STEPS} />
        {step < TOTAL_STEPS - 1 && (
          <button
            type="button"
            onClick={skip}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-muted active:bg-surface-3"
          >
            <X size={14} /> Skip
          </button>
        )}
      </div>

      {/* Step content */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-28">
        <div className="mx-auto w-full max-w-md flex-1 pt-4">
          {step === 0 && <WelcomeStep />}
          {step === 1 && <NameStep value={name} onChange={setName} onSubmit={() => void next()} />}
          {step === 2 && <LlmIntroStep />}
          {step === 3 && (
            <GeminiKeyStep
              apiKey={apiKey}
              onKeyChange={setApiKey}
              saving={keySaving}
              msg={keyMsg}
              err={keyErr}
              onSubmit={() => void next()}
            />
          )}
          {step === 4 && <NavTourStep />}
          {step === 5 && <FeatureTourStep />}
          {step === 6 && <CompleteStep />}
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-edge bg-surface/90 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={back}
              className="flex items-center gap-1.5 rounded-2xl border border-edge px-4 py-2.5 text-sm text-ink-muted active:bg-surface-3"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={() => void next()}
            disabled={advancing || keySaving}
            className="brand-gradient flex items-center gap-1.5 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/30 active:scale-[.98] disabled:opacity-50"
          >
            {advancing || keySaving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : step === 0 ? (
              "Get Started"
            ) : step >= TOTAL_STEPS - 1 ? (
              "Finish"
            ) : (
              "Next"
            )}
            {!advancing && !keySaving && step < TOTAL_STEPS - 1 && <ArrowRight size={14} />}
            {!advancing && !keySaving && step >= TOTAL_STEPS - 1 && <Check size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Progress dots =====

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === current
              ? "w-6 bg-accent"
              : i < current
                ? "w-1.5 bg-accent/60"
                : "w-1.5 bg-surface-3"
          }`}
        />
      ))}
    </div>
  );
}

// ===== Step 0: Welcome =====

function WelcomeStep() {
  return (
    <div className="flex flex-col items-center pt-12 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-accent/20 shadow-lg shadow-accent/20">
        <AppLogo size={48} />
      </div>
      <h1 className="font-display mb-2 text-3xl font-bold tracking-tight text-ink">
        Welcome to Mavino
      </h1>
      <p className="mb-2 text-base text-ink-muted">Student OS</p>
      <p className="mt-4 max-w-xs text-sm leading-6 text-ink-muted">
        Your productivity dashboard with notes, tasks, an AI assistant,
        calendar, flashcards, and more.
      </p>
      <p className="mt-6 text-sm text-ink-muted">
        Let's get you set up in under a minute.
      </p>
    </div>
  );
}

// ===== Step 1: Name =====

function NameStep({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col items-center pt-10 text-center">
      <MobileIconChip icon={<UserRound size={24} />} size="lg" />
      <h2 className="font-display mb-2 mt-5 text-2xl font-bold text-ink">
        What should we call you?
      </h2>
      <p className="max-w-xs text-sm text-ink-muted">
        Used for greetings and when Mavino talks to you. You can change it
        anytime in Settings.
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
        className="mt-6 w-full max-w-xs rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-center text-base text-ink outline-none placeholder:text-ink-muted transition focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
      />
      <p className="mt-3 text-xs text-ink-muted/70">
        Optional — skip it and Mavino will ask later.
      </p>
    </div>
  );
}

// ===== Step 2: LLM intro =====

function LlmIntroStep() {
  return (
    <div className="flex flex-col items-center pt-10 text-center">
      <MobileIconChip icon={<KeyRound size={24} />} size="lg" />
      <h2 className="font-display mb-2 mt-5 text-2xl font-bold text-ink">
        Connect to an AI
      </h2>
      <p className="max-w-xs text-sm leading-6 text-ink-muted">
        Mavino needs an LLM API key to power chat, study tools, and smart
        features. We recommend{" "}
        <strong className="text-ink">Google Gemini</strong> — it has a generous
        free tier.
      </p>
      <div className="mt-5 flex max-w-xs items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-xs leading-5 text-amber-200">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <span>
          For data privacy, prefer providers outside China (e.g. Google,
          OpenAI, Anthropic). Some China-hosted models have less protective
          data policies.
        </span>
      </div>
      <p className="mt-5 text-sm text-ink-muted">
        On the next step, we'll help you get a free Gemini key.
      </p>
    </div>
  );
}

// ===== Step 3: Gemini key =====

function GeminiKeyStep({
  apiKey,
  onKeyChange,
  saving,
  msg,
  err,
  onSubmit,
}: {
  apiKey: string;
  onKeyChange: (v: string) => void;
  saving: boolean;
  msg: string | null;
  err: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="pt-6">
      <div className="mb-5 flex items-center gap-3">
        <MobileIconChip icon={<KeyRound size={20} />} size="md" />
        <h2 className="font-display text-xl font-bold text-ink">
          Get your Gemini key
        </h2>
      </div>

      <div className="space-y-3">
        <NumberedStep n={1}>
          <span>
            Open{" "}
            <button
              type="button"
              onClick={() =>
                window.open(GEMINI_KEYS_URL, "_blank", "noopener,noreferrer")
              }
              className="inline-flex items-center gap-1 text-accent underline"
            >
              Google AI Studio <ExternalLink size={12} />
            </button>{" "}
            and sign in with your Google account.
          </span>
        </NumberedStep>
        <NumberedStep n={2}>
          Click <strong className="text-ink">Create API key</strong>, pick any
          project (or the default), then click <strong className="text-ink">Create</strong>.
        </NumberedStep>
        <NumberedStep n={3}>
          Copy the key and paste it below.
        </NumberedStep>
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={() =>
            window.open(GEMINI_KEYS_URL, "_blank", "noopener,noreferrer")
          }
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent/10 py-3 text-sm font-medium text-accent active:bg-accent/20"
        >
          <ExternalLink size={16} /> Open Google AI Studio
        </button>
        <input
          type="password"
          value={apiKey}
          disabled={saving}
          onChange={(e) => onKeyChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Paste your API key (AIza...)"
          aria-label="Gemini API key"
          autoComplete="off"
          className="w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-center text-base text-ink outline-none placeholder:text-ink-muted transition focus:border-accent/70 focus:ring-2 focus:ring-accent/15 disabled:opacity-50"
        />
      </div>

      {msg && (
        <p className={`mt-3 text-center text-xs ${err ? "text-red-400" : "text-emerald-400"}`}>
          {msg}
        </p>
      )}

      <p className="mt-4 text-center text-xs text-ink-muted/70">
        You can skip this and add a key later in Settings.
      </p>
    </div>
  );
}

function NumberedStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-edge bg-surface-2 p-4">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
        {n}
      </span>
      <span className="text-sm leading-6 text-ink-muted">{children}</span>
    </div>
  );
}

// ===== Step 4: Navigation tour =====

function NavTourStep() {
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <MobileIconChip icon={<Sparkles size={24} />} size="lg" />
      <h2 className="font-display mb-2 mt-5 text-2xl font-bold text-ink">
        Here's how to get around
      </h2>
      <p className="mb-6 text-sm text-ink-muted">
        Use the bottom tabs to navigate between your main views.
      </p>
      <div className="w-full space-y-2.5">
        <NavItem icon={<Home size={18} />} name="Home" desc="Today's agenda, tasks, and quick actions" />
        <NavItem icon={<CheckSquare size={18} />} name="Tasks" desc="Your to-do list with priorities and due dates" />
        <NavItem icon={<CalendarDays size={18} />} name="Calendar" desc="Your schedule and upcoming events" />
        <NavItem icon={<AppLogo size={18} />} name="Mavino" desc="AI assistant — chat, study help, and more" isLogo />
        <NavItem icon={<MoreHorizontal size={18} />} name="More" desc="All your apps in one place" />
      </div>
    </div>
  );
}

function NavItem({
  icon,
  name,
  desc,
  isLogo,
}: {
  icon: React.ReactNode;
  name: string;
  desc: string;
  isLogo?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3.5 text-left">
      {isLogo ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl">
          {icon}
        </span>
      ) : (
        <MobileIconChip icon={icon} size="md" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{name}</p>
        <p className="text-xs text-ink-muted">{desc}</p>
      </div>
    </div>
  );
}

// ===== Step 5: Feature highlights =====

function FeatureTourStep() {
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <MobileIconChip icon={<Sparkles size={24} />} size="lg" />
      <h2 className="font-display mb-2 mt-5 text-2xl font-bold text-ink">
        Packed with tools
      </h2>
      <p className="mb-6 text-sm text-ink-muted">
        Explore these from the More tab or ask Mavino to open them.
      </p>
      <div className="grid w-full grid-cols-2 gap-3">
        <FeatureCard icon={<StickyNote size={20} />} name="Notes" desc="Markdown, LaTeX, folders" />
        <FeatureCard icon={<Brain size={20} />} name="Flashcards" desc="Spaced repetition" />
        <FeatureCard icon={<Timer size={20} />} name="Focus" desc="Pomodoro timer" />
        <FeatureCard icon={<BookOpen size={20} />} name="Study Hub" desc="AI study workflows" />
      </div>
      <p className="mt-5 text-sm text-ink-muted">
        ...and 20+ more apps covering grades, habits, voice notes, maps, and beyond.
      </p>
    </div>
  );
}

function FeatureCard({ icon, name, desc }: { icon: React.ReactNode; name: string; desc: string }) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-edge bg-surface-2 p-4 text-center">
      <MobileIconChip icon={icon} size="md" />
      <p className="text-sm font-semibold text-ink">{name}</p>
      <p className="text-xs text-ink-muted">{desc}</p>
    </div>
  );
}

// ===== Step 6: Complete =====

function CompleteStep() {
  return (
    <div className="flex flex-col items-center pt-12 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/20">
        <Check size={32} className="text-emerald-400" />
      </div>
      <h2 className="font-display mb-2 text-2xl font-bold text-ink">
        You're all set!
      </h2>
      <p className="max-w-xs text-sm leading-6 text-ink-muted">
        Your workspace is ready. Start exploring — open apps from the bottom
        tabs, or ask Mavino for help.
      </p>

      {/* Single tasteful desktop tip */}
      <div className="mt-8 flex max-w-xs items-start gap-3 rounded-2xl border border-accent/20 bg-accent/[0.07] px-4 py-3 text-left text-xs leading-5 text-ink-muted">
        <MobileIconChip icon={<Monitor size={14} />} size="sm" />
        <span className="pt-1.5">
          For the full experience with multi-window layout, keyboard shortcuts,
          and advanced tools like the knowledge graph and tour planner, try
          Mavino on a computer.
        </span>
      </div>
    </div>
  );
}
