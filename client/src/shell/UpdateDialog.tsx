/**
 * In-app update dialog for the Capacitor (Android) build.
 *
 * Rendered once at the top of the React tree (see App.tsx). Reads from the
 * `useUpdater` store — any caller can surface an update by calling
 * `promptUpdate(info)`.
 *
 * States:
 *   - idle (no pending update) → renders nothing
 *   - prompt → shows version + release notes + Download & Install / Later / Skip
 *   - downloading → indeterminate spinner (the native plugin streams the APK)
 *   - installing → system installer dialog is showing; we show a waiting state
 *   - error → message + retry / dismiss
 *
 * On web/PWA builds the store is never populated, so this is a no-op.
 */
import { useState } from "react";
import { Download, Loader2, ExternalLink, Ban } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useUpdater } from "../store/updater";
import { downloadAndInstall, skipVersion } from "../services/updater";
import { Dialog } from "../ui/overlays";
import { Alert, Button } from "../ui/primitives";

type Phase = "prompt" | "downloading" | "installing" | "error";

export default function UpdateDialog() {
  const { pending, dismiss } = useUpdater();
  const [phase, setPhase] = useState<Phase>("prompt");
  const [error, setError] = useState<string | null>(null);

  if (!pending) return null;

  const close = () => {
    setPhase("prompt");
    setError(null);
    dismiss();
  };

  const handleSkip = () => {
    skipVersion(pending.version);
    close();
  };

  const handleInstall = async () => {
    setPhase("downloading");
    setError(null);
    try {
      // Resolves once the system installer intent has been launched.
      await downloadAndInstall(pending);
      setPhase("installing");
      // The user is now in Android's system install UI. We leave the dialog
      // showing an "installing" state; if they cancel the system dialog and
      // return to Athena, they can dismiss this manually.
    } catch (e: any) {
      setPhase("error");
      setError(e?.message || "Download failed. Check your connection and try again.");
    }
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (phase === "prompt" || phase === "error") close();
      }}
      title="Update available"
      description={`Mavino v${pending.version}`}
      className="max-w-md"
      hideClose={phase === "downloading" || phase === "installing"}
      footer={
        phase === "downloading" ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 size={16} className="animate-spin" />
            <span>Downloading…</span>
          </div>
        ) : phase === "installing" ? (
          <Button variant="secondary" onClick={close}>Dismiss</Button>
        ) : phase === "error" ? (
          <>
            <Button variant="secondary" onClick={close}>Close</Button>
            <Button onClick={handleInstall} leadingIcon={<Download size={14} />}>Retry</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={handleSkip} leadingIcon={<Ban size={14} />}>Skip this version</Button>
            <Button variant="secondary" onClick={() => window.open(pending.htmlUrl, "_blank", "noopener,noreferrer")} leadingIcon={<ExternalLink size={14} />}>View on GitHub</Button>
            <Button onClick={handleInstall} leadingIcon={<Download size={14} />}>Download & Install</Button>
          </>
        )
      }
    >
      <div className="max-h-[50vh] overflow-y-auto">
        {phase === "error" ? (
          <Alert variant="danger">
            <p className="font-medium">Couldn’t install the update</p>
            <p className="mt-1 text-xs text-danger/80">{error}</p>
          </Alert>
        ) : phase === "installing" ? (
          <div className="flex items-center gap-2.5 py-2 text-sm text-ink-muted">
            <Loader2 size={16} className="animate-spin" />
            <span>
              Android is installing the update. Confirm in the system dialog, then reopen
              Mavino.
            </span>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-muted">
              {pending.publishedAt
                ? `Released ${new Date(pending.publishedAt).toLocaleDateString()}`
                : "A new version is available."}
            </p>
            {pending.notes ? (
              <div className="prose prose-sm prose-invert max-w-none text-sm text-ink-muted [&_a]:text-accent [&_code]:rounded [&_code]:bg-surface-3 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
                <ReactMarkdown>{pending.notes}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No release notes provided.</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
