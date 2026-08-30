/**
 * Thin fetch wrapper for the Athena backend.
 * - Reads JWT from localStorage and attaches Authorization header.
 * - On 401, attempts a single refresh-token rotation (using the stored
 *   refresh token + device fingerprint) and retries the original request.
 * - On refresh failure, clears tokens (the auth store will redirect to login).
 * - On web, all paths are relative ("/api/...") and proxied by Vite in dev /
 *   nginx in prod. On the Capacitor native app, the web content is served
 *   from https://localhost so relative paths would hit the local WebView —
 *   instead we prepend a base URL that the user configures (stored in
 *   localStorage as athena.serverUrl).
 */

import { Capacitor } from "@capacitor/core";
import { resolveServerUrl } from "./server-url";

const TOKEN_KEY = "athena.token";
const REFRESH_KEY = "athena.refresh";
const SERVER_URL_KEY = "athena.serverUrl";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

/**
 * Returns the backend base URL for API calls.
 * - On web: "" (empty string — relative paths are proxied by Vite/nginx).
 * - On Capacitor native: the user-configured server URL from localStorage
 *   (e.g. "http://192.168.1.100:3001"), with trailing slash stripped.
 *   Falls back to "" if not yet configured (the login screen will prompt).
 */
export function getBaseUrl(): string {
  return resolveServerUrl(
    Capacitor.isNativePlatform(),
    __PLAY_BUILD__,
    localStorage.getItem(SERVER_URL_KEY)
  );
}

/** Sets the backend server URL (used by the Capacitor native app). */
export function setBaseUrl(url: string | null) {
  if (__PLAY_BUILD__) return;
  if (url) localStorage.setItem(SERVER_URL_KEY, url);
  else localStorage.removeItem(SERVER_URL_KEY);
}

/** Returns true if the server URL has been configured (native only). */
export function isServerUrlConfigured(): boolean {
  return __PLAY_BUILD__ || !!localStorage.getItem(SERVER_URL_KEY);
}

/** Prepends the base URL to a path if running natively. */
export function apiUrl(path: string): string {
  return getBaseUrl() + path;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * Attempt a single refresh-token rotation. Returns true on success (a new
 * access token is stored). Returns false if there's no refresh token or the
 * rotation failed (tokens are cleared on failure). Concurrent callers share
 * the same in-flight refresh promise.
 *
 * Exported so raw-fetch callers (e.g. the Athena SSE stream in athena.ts,
 * which can't go through `request()` because it streams) can handle 401s the
 * same way the standard API wrapper does.
 */
export async function refreshAuthToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    const { getFingerprint } = await import("./fingerprint");
    const fingerprint = await getFingerprint();
    try {
      const res = await fetch(apiUrl("/api/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken, deviceFingerprint: fingerprint }),
      });
      if (!res.ok) {
        setToken(null);
        setRefreshToken(null);
        return false;
      }
      const data = await res.json();
      setToken(data.token);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      return true;
    } catch {
      setToken(null);
      setRefreshToken(null);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const token = getToken();
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (init.body && !(init.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(apiUrl(path), { ...init, headers });
  };

  let res = await doFetch();

  // On 401, try one refresh + retry (skip for the refresh endpoint itself to avoid loops).
  if (res.status === 401 && !path.startsWith("/api/auth/refresh")) {
    const ok = await refreshAuthToken();
    if (ok) {
      res = await doFetch();
    } else {
      setToken(null);
      setRefreshToken(null);
    }
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Server returned a non-JSON response (e.g. nginx HTML error page,
      // or a plain-text error from a proxy). Wrap it so the caller gets
      // a meaningful message instead of a JSON.parse crash.
      if (!res.ok) {
        throw new ApiError(
          res.status,
          text.length < 200 ? text : `Request failed (${res.status})`,
          text
        );
      }
      throw new ApiError(res.status, "Malformed server response (not JSON)", text);
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      setRefreshToken(null);
    }
    const message =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  /** Raw fetch for binary downloads (returns Response). Does NOT auto-refresh. */
  raw: (path: string, init: RequestInit = {}) => {
    const token = getToken();
    const headers = { ...(init.headers as Record<string, string>) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(apiUrl(path), { ...init, headers });
  },
};
