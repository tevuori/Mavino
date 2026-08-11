/**
 * In-app APK self-update service for the Capacitor (Android) build of Mavino.
 *
 * Flow:
 *   1. `checkForUpdate()` queries the GitHub Releases API for the latest
 *      release of the configured repo and compares its tag against the
 *      currently-installed app version (from `App.getInfo().version`).
 *   2. If a newer version is available (and not skipped by the user), the
 *      caller shows a dialog with the release notes.
 *   3. `downloadAndInstall()` hands the APK URL to the native `ApkUpdater`
 *      plugin, which streams it to disk, verifies the SHA256 (if provided),
 *      and launches Android's system package installer.
 *
 * On web/PWA builds this module is effectively a no-op: `isCapacitor()`
 * returns false and `checkForUpdate` returns null.
 *
 * Repo slug is auto-detected from `git remote get-url origin` at build time
 * (see client/vite.config.ts) and exposed as `__UPDATE_REPO__`. If detection
 * fails (e.g. no git in the build env), updates are disabled.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

// Local Capacitor plugin registered in MainActivity.java.
interface ApkUpdaterPlugin {
  downloadAndInstall(opts: { url: string; sha256?: string }): Promise<{ launched: boolean }>;
}
const ApkUpdater = registerPlugin<ApkUpdaterPlugin>("ApkUpdater");

const SKIP_VERSION_KEY = "athena.update.skippedVersion";

export interface UpdateInfo {
  /** New version string (e.g. "1.2.3"), parsed from the release tag. */
  version: string;
  /** APK download URL (a release asset browser_download_url). */
  apkUrl: string;
  /** Optional SHA256 hex digest of the APK, if a `*.sha256` asset is present. */
  sha256?: string;
  /** Release body (markdown) — shown as release notes. */
  notes: string;
  /** GitHub release HTML URL (for "View on GitHub" link). */
  htmlUrl: string;
  /** ISO publication timestamp from the GitHub API. */
  publishedAt: string;
}

/**
 * Returns true if running inside the Capacitor native shell AND a repo slug
 * was baked in at build time AND this is NOT a Play Store build. Used by
 * callers to gate update UI. Play builds (VITE_PLAY_BUILD=true) compile
 * __PLAY_BUILD__ as true and are excluded — they receive updates through
 * the Play Store, and the in-app APK installer is disabled both here (JS)
 * and in the play flavor's manifest (REQUEST_INSTALL_PACKAGES stripped).
 */
export function isAutoUpdateAvailable(): boolean {
  return Capacitor.isNativePlatform() && !!__UPDATE_REPO__ && !__PLAY_BUILD__;
}

/** Currently-installed app version. On native: from App.getInfo(); on web: __APP_VERSION__. */
export async function getInstalledVersion(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await CapApp.getInfo();
      return info.version;
    } catch {
      // Fall through to build-time constant.
    }
  }
  return __APP_VERSION__;
}

/**
 * Compares two semver strings (e.g. "1.2.3" vs "1.10.0"). Returns true if
 * `remote` is strictly newer than `local`. Pre-release suffixes are ignored
 * (we only ship stable releases via the workflow).
 */
export function isNewerVersion(local: string, remote: string): boolean {
  const parse = (v: string): number[] =>
    v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(local), parse(remote)];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (bi > ai) return true;
    if (bi < ai) return false;
  }
  return false;
}

/**
 * Queries GitHub Releases for the latest release of the configured repo.
 * Returns `null` if:
 *   - not running in a native shell,
 *   - no repo slug was baked in,
 *   - the latest release is not newer than the installed version,
 *   - the user has skipped this version,
 *   - the release has no APK asset,
 *   - or the API call fails (rate limit, network, etc.).
 *
 * Pass `includeSkipped: true` to ignore the skip flag (used by the manual
 * "Check for updates" button in Settings → About).
 */
export async function checkForUpdate(opts?: {
  includeSkipped?: boolean;
}): Promise<UpdateInfo | null> {
  if (!isAutoUpdateAvailable() || !__UPDATE_REPO__) return null;

  const installed = await getInstalledVersion();

  let release: any;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${__UPDATE_REPO__}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) return null;
    release = await res.json();
  } catch {
    return null;
  }

  // Tag looks like "v1.2.3" — strip the leading "v".
  const tag: string = release.tag_name || "";
  const version = tag.replace(/^v/i, "");
  if (!version || !isNewerVersion(installed, version)) return null;

  if (!opts?.includeSkipped) {
    const skipped = localStorage.getItem(SKIP_VERSION_KEY);
    if (skipped === version) return null;
  }

  // Find the APK asset (any asset ending in .apk, case-insensitive).
  const assets: any[] = release.assets || [];
  const apkAsset = assets.find((a) => a.name?.toLowerCase().endsWith(".apk"));
  if (!apkAsset || !apkAsset.browser_download_url) return null;

  // Optional: look for a matching *.sha256 sidecar asset.
  const sha256Asset = assets.find((a) =>
    a.name?.toLowerCase().endsWith(".apk.sha256") ||
    a.name?.toLowerCase().endsWith(".sha256")
  );
  let sha256: string | undefined;
  if (sha256Asset?.browser_download_url) {
    try {
      const r = await fetch(sha256Asset.browser_download_url);
      if (r.ok) {
        // Sidecar format is typically "<hex>  <filename>" — take the first token.
        const text = (await r.text()).trim().split(/\s+/)[0];
        if (/^[0-9a-f]{64}$/i.test(text)) sha256 = text.toLowerCase();
      }
    } catch {
      // SHA verification is best-effort; absence is not fatal.
    }
  }

  return {
    version,
    apkUrl: apkAsset.browser_download_url,
    sha256,
    notes: release.body || "",
    htmlUrl: release.html_url || "",
    publishedAt: release.published_at || "",
  };
}

/** Marks a version as skipped so `checkForUpdate` won't surface it again. */
export function skipVersion(version: string): void {
  localStorage.setItem(SKIP_VERSION_KEY, version);
}

/** Clears any previously-skipped version. */
export function clearSkippedVersion(): void {
  localStorage.removeItem(SKIP_VERSION_KEY);
}

/**
 * Downloads the APK and launches the system package installer.
 * Resolves once the installer intent has been launched (the actual install
 * confirmation happens in Android's system UI). Rejects on download/hash
 * failures or if the plugin is unavailable.
 */
export async function downloadAndInstall(update: UpdateInfo): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Auto-update is only available in the native Android app.");
  }
  await ApkUpdater.downloadAndInstall({
    url: update.apkUrl,
    sha256: update.sha256,
  });
}
