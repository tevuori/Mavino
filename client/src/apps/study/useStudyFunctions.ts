import { useEffect, useState } from "react";
import { studyFunctionsApi, type StudyFunctionDef } from "../../services/study-functions";

export type MinTier = "free" | "paid" | "pro" | null;

/** Hook that loads the Study Hub functions enabled for the current user,
 *  plus the minimum tier required for each function (so the UI can show
 *  locked functions with an "Available in Paid/Pro" badge). */
export function useStudyFunctions(): {
  enabled: Set<string>;
  functions: StudyFunctionDef[];
  minTiers: Record<string, MinTier>;
  loading: boolean;
  error: string;
} {
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [functions, setFunctions] = useState<StudyFunctionDef[]>([]);
  const [minTiers, setMinTiers] = useState<Record<string, MinTier>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    studyFunctionsApi
      .getMyFunctions()
      .then((res) => {
        if (!cancelled) {
          setEnabled(new Set(res.enabled));
          setFunctions(res.functions ?? []);
          setMinTiers(res.minTiers ?? {});
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load Study Hub functions");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, functions, minTiers, loading, error };
}
