import { useState } from "react";
import { X } from "lucide-react";
import LoginScreen from "./LoginScreen";
import OpenTestingSignup from "./OpenTestingSignup";

interface Props {
  open: boolean;
  onClose: () => void;
  initialMode: "login" | "signup";
}

type Mode = "login" | "signup";

export default function AuthModal({ open, onClose, initialMode }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[16000] flex items-start justify-center overflow-y-auto bg-scrim/60 px-4 py-10 backdrop-blur-sm">
      <div className="relative my-auto w-full max-w-sm rounded-xl border border-edge bg-surface p-6 shadow-panel">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {mode === "login" ? (
          <LoginScreen embedded onSwitchToSignup={() => setMode("signup")} />
        ) : (
          <OpenTestingSignup onDone={onClose} />
        )}

        <div className="mt-4 text-center text-[11px] text-ink-muted">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="font-medium text-accent hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="font-medium text-accent hover:underline"
              >
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
