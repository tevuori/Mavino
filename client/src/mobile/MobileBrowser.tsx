import { useState, useRef } from "react";
import { ArrowLeft as BackIcon, ArrowRight as ForwardIcon, Globe, Link2, Search, Sparkles, Trash2 } from "lucide-react";
import { browserApi } from "../services/browser";
import { useMobileToast } from "../store/mobileToast";
import { MobileEmpty, MobileHeader, MobileInput, MobileTextarea } from "./MobileUi";

const QUICK_LINKS = [
  { name: "Wikipedia", url: "https://en.wikipedia.org" },
  { name: "Wolfram", url: "https://wolframalpha.com" },
  { name: "Google", url: "https://google.com" },
  { name: "GitHub", url: "https://github.com" },
];

export default function MobileBrowser({ onClose }: { onClose?: () => void }) {
  const toast = useMobileToast((s) => s.show);
  const [url, setUrl] = useState("");
  const [current, setCurrent] = useState("");
  const [tab, setTab] = useState<"web" | "text">("web");
  const [pageText, setPageText] = useState<null | { title: string; content: string; error?: string }>(null);
  const [loading, setLoading] = useState(false);

  // Navigation history with index for back/forward
  const [history, setHistory] = useState<string[]>([]);
  const historyIdx = useRef(-1);

  const go = (u: string) => {
    let target = u.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    setUrl(target);
    setCurrent(target);
    setPageText(null);
    setTab("web");
    // Push to history: trim forward entries if we navigated back then typed a new URL
    const newHistory = [...history.slice(0, historyIdx.current + 1), target].slice(-30);
    setHistory(newHistory);
    historyIdx.current = newHistory.length - 1;
  };

  const canGoBack = historyIdx.current > 0;
  const canGoForward = historyIdx.current < history.length - 1;

  const goBack = () => {
    if (!canGoBack) return;
    historyIdx.current -= 1;
    const target = history[historyIdx.current];
    setUrl(target);
    setCurrent(target);
    setPageText(null);
    setTab("web");
  };

  const goForward = () => {
    if (!canGoForward) return;
    historyIdx.current += 1;
    const target = history[historyIdx.current];
    setUrl(target);
    setCurrent(target);
    setPageText(null);
    setTab("web");
  };

  const extract = async () => {
    if (!current) return;
    setLoading(true);
    try {
      const res = await browserApi.content(current);
      if (res.error) setPageText({ title: res.title, content: "", error: res.error });
      else setPageText({ title: res.title, content: res.content });
      setTab("text");
    } catch (e) {
      setPageText({ title: "Error", content: "", error: e instanceof Error ? e.message : "Failed" });
      setTab("text");
    }
    setLoading(false);
  };

  const clearCookies = async () => {
    await browserApi.clearCookies().catch(() => { toast("Failed to clear cookies", "error"); });
    setPageText({ title: "Cleared", content: "Browser cookie jar cleared." });
    setTab("text");
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Fixed header area */}
      <div className="shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <MobileHeader title="Browser" subtitle="Research with Mavino" onClose={onClose} />

        <div className="mb-2 flex gap-2 rounded-2xl border border-edge bg-surface-2 p-2">
          <Globe size={18} className="mt-2.5 ml-2 shrink-0 text-ink-muted" />
          <MobileInput
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(url); }}
            placeholder="Enter URL or search"
            className="border-0 bg-transparent"
          />
          <button
            type="button"
            onClick={() => { setTab("web"); go(url); }}
            className="shrink-0 rounded-xl bg-accent px-3 text-sm font-semibold text-ink"
          >
            <Search size={18} />
          </button>
        </div>

        <div className="mb-2 flex gap-2">
          {/* Back / Forward buttons */}
          <button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3 disabled:opacity-30"
            aria-label="Back"
          >
            <BackIcon size={16} />
          </button>
          <button
            type="button"
            onClick={goForward}
            disabled={!canGoForward}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3 disabled:opacity-30"
            aria-label="Forward"
          >
            <ForwardIcon size={16} />
          </button>
          <button
            type="button"
            onClick={() => setTab("web")}
            className={`flex-1 rounded-2xl py-2 text-sm font-medium ${tab === "web" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"}`}
          >
            Web
          </button>
          <button
            type="button"
            onClick={() => void extract()}
            disabled={!current || loading}
            className={`flex-1 flex items-center justify-center gap-1 rounded-2xl py-2 text-sm font-medium ${
              tab === "text" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
            } disabled:opacity-50`}
          >
            <Sparkles size={14} /> {loading ? "Reading..." : "Extract"}
          </button>
          <button
            type="button"
            onClick={() => void clearCookies()}
            className="rounded-2xl bg-surface-2 px-3 text-ink-muted"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Content area — fills remaining height */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {tab === "web" && current && (
          <iframe
            src={browserApi.proxyUrl(current)}
            title="browser"
            className="h-full w-full rounded-2xl border border-edge bg-surface-2"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}

        {tab === "text" && (
          <div className="rounded-2xl border border-edge bg-surface-2 p-4">
            {pageText ? (
              <>
                <p className="mb-2 text-sm font-semibold text-accent">{pageText.title}</p>
                {pageText.error ? (
                  <p className="text-sm text-rose-300">{pageText.error}</p>
                ) : (
                  <MobileTextarea readOnly value={pageText.content} rows={16} className="border-0 bg-transparent text-ink-muted" />
                )}
              </>
            ) : (
              <MobileEmpty text="Tap Extract to pull the main text from the page." />
            )}
          </div>
        )}

        {!current && tab === "web" && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {QUICK_LINKS.map((l) => (
                <button
                  key={l.url}
                  type="button"
                  onClick={() => go(l.url)}
                  className="flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 p-4 text-left active:bg-surface-3"
                >
                  <Link2 size={18} className="text-accent" />
                  <span className="text-sm text-ink">{l.name}</span>
                </button>
              ))}
            </div>

            {history.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold text-ink-muted">History</p>
                <div className="flex flex-wrap gap-2">
                  {history.map((h, i) => (
                    <button
                      key={`${h}-${i}`}
                      type="button"
                      onClick={() => go(h)}
                      className="max-w-[10rem] truncate rounded-full bg-surface-2 px-3 py-1 text-xs text-ink-muted"
                    >
                      {h.replace(/^https?:\/\//, "")}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
