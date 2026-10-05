import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useAppAccessible, useFeatures } from "../../store/features";
import { useStudyFunctions, type MinTier } from "../study/useStudyFunctions";
import StudyFunctionLocked from "../study/StudyFunctionLocked";
import { ErrorBanner, Loading } from "../study/ui";

export default function TeachAccessBoundary({ children, onUpgrade }: { children: ReactNode; onUpgrade?: () => void }) {
  const appAccess = useAppAccessible("teach");
  const appTier = useFeatures((state) => state.appTiers.teach ?? "free");
  const { enabled, functions, minTiers, loading, error } = useStudyFunctions();

  if (appAccess === "hidden") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Lock size={28} className="text-ink-muted" />
        <div>
          <p className="text-sm font-semibold text-ink">Teach Me is unavailable</p>
          <p className="mt-1 text-xs text-ink-muted">This application has been disabled by an administrator.</p>
        </div>
      </div>
    );
  }

  if (appAccess === "preview") {
    return <StudyFunctionLocked fn={{ id: "teach", label: "Teach Me", description: "Your adaptive, source-grounded classroom." }} minTier={appTier} onUpgrade={onUpgrade} />;
  }

  if (loading) return <div className="flex h-full items-center justify-center"><Loading label="Checking Teach Me access…" /></div>;
  if (error) return <div className="mx-auto w-full max-w-md py-8"><ErrorBanner message="Teach Me access could not be verified. Please try again." /></div>;
  if (enabled.has("teach")) return <>{children}</>;

  const fn = functions.find((item) => item.id === "teach") ?? {
    id: "teach",
    label: "Teach Me",
    description: "Interactive live tutoring from sources.",
  };
  const minTier: MinTier = minTiers.teach ?? null;
  return <StudyFunctionLocked fn={fn} minTier={minTier} onUpgrade={onUpgrade} />;
}
