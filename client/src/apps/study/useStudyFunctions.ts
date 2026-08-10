import { useEffect, useState } from "react";
import { studyFunctionsApi } from "../../services/study-functions";

/** Hook that loads the Study Hub functions enabled for the current user. */
export function useStudyFunctions(): { enabled: Set<string>; loading: boolean; error: string } {
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    studyFunctionsApi
      .getMyFunctions()
      .then((res) => {
        if (!cancelled) {
          setEnabled(new Set(res.enabled));
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

  return { enabled, loading, error };
}
