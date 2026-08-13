import { create } from "zustand";
import type { User } from "../types";
import { api, getToken, setToken, getRefreshToken, setRefreshToken } from "../services/api";
import { getFingerprint } from "../services/fingerprint";

interface AuthState {
  user: User | null;
  token: string | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: (username: string, password: string, rememberMe?: boolean, turnstileToken?: string) => Promise<void>;
  loginWithTotp: (challengeToken: string, totpCode: string, rememberMe?: boolean) => Promise<void>;
  register: (username: string, password: string, displayName?: string, turnstileToken?: string) => Promise<void>;
  tryDemo: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (patch: { displayName?: string; avatarColor?: string; email?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: getToken(),
  status: "loading",

  login: async (username, password, rememberMe = true, turnstileToken?: string) => {
    const fingerprint = rememberMe ? await getFingerprint() : "";
    const data = await api.post<
      | { token: string; refreshToken: string | null; user: User }
      | { totpRequired: true; challengeToken: string; user: User }
    >("/api/auth/login", { username, password, rememberMe, deviceFingerprint: fingerprint, turnstileToken });
    // If 2FA is required, throw a special error so the LoginScreen can show
    // the TOTP input. The challenge token is attached to the error.
    if ("totpRequired" in data) {
      const err = new Error("2FA required") as Error & { totpChallenge?: string };
      err.totpChallenge = data.challengeToken;
      throw err;
    }
    setToken(data.token);
    setRefreshToken(data.refreshToken);
    set({ token: data.token, user: data.user, status: "authenticated" });
  },

  loginWithTotp: async (challengeToken, totpCode, rememberMe = true) => {
    const fingerprint = rememberMe ? await getFingerprint() : "";
    const data = await api.post<{ token: string; refreshToken: string | null; user: User }>(
      "/api/auth/login/totp",
      { challengeToken, totpCode, rememberMe, deviceFingerprint: fingerprint }
    );
    setToken(data.token);
    setRefreshToken(data.refreshToken);
    set({ token: data.token, user: data.user, status: "authenticated" });
  },

  register: async (username, password, displayName, turnstileToken?: string) => {
    // Bootstrap-only endpoint (first admin). After that it 403s.
    const data = await api.post<{ token: string; refreshToken: string | null; user: User }>(
      "/api/auth/register",
      { username, password, displayName, turnstileToken }
    );
    setToken(data.token);
    setRefreshToken(data.refreshToken);
    set({ token: data.token, user: data.user, status: "authenticated" });
  },

  tryDemo: async () => {
    const fingerprint = await getFingerprint();
    const data = await api.post<{ token: string; refreshToken: string | null; user: User }>(
      "/api/auth/demo",
      { deviceFingerprint: fingerprint, deviceLabel: "Demo browser" }
    );
    setToken(data.token);
    setRefreshToken(data.refreshToken);
    sessionStorage.setItem("demo-just-logged-in", "1");
    set({ token: data.token, user: data.user, status: "authenticated" });
  },

  logout: async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await api.post("/api/auth/logout", { refreshToken });
      } catch {
        /* ignore — clear locally regardless */
      }
    }
    setToken(null);
    setRefreshToken(null);
    sessionStorage.removeItem("demo-just-logged-in");
    set({ user: null, token: null, status: "unauthenticated" });
  },

  refresh: async () => {
    const token = getToken();
    if (!token) {
      // No access token, but maybe a refresh token can recover the session.
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          const fingerprint = await getFingerprint();
          const data = await api.post<{ token: string; refreshToken: string; user: User }>(
            "/api/auth/refresh",
            { refreshToken, deviceFingerprint: fingerprint }
          );
          setToken(data.token);
          setRefreshToken(data.refreshToken);
          set({ user: data.user, token: data.token, status: "authenticated" });
          return;
        } catch {
          /* fall through to unauthenticated */
        }
      }
      set({ status: "unauthenticated", user: null, token: null });
      return;
    }
    try {
      const user = await api.get<User>("/api/auth/me");
      set({ user, token, status: "authenticated" });
    } catch {
      // 401 auto-refresh in api.ts already tried; if we're here it failed.
      setToken(null);
      setRefreshToken(null);
      set({ status: "unauthenticated", user: null, token: null });
    }
  },

  updateProfile: async (patch) => {
    const user = await api.patch<User>("/api/auth/profile", patch);
    set({ user: { ...get().user, ...user } });
  },

  changePassword: async (currentPassword, newPassword) => {
    await api.post("/api/auth/password", { currentPassword, newPassword });
    // Password change revokes all refresh tokens server-side; clear locally.
    setRefreshToken(null);
    // Clear the must-change flag in the local user object so the UI proceeds.
    const cur = get().user;
    if (cur) set({ user: { ...cur, passwordMustChange: false } });
  },

  deleteAccount: async (password) => {
    await api.delete("/api/auth/account", { password });
    setToken(null);
    setRefreshToken(null);
    set({ user: null, token: null, status: "unauthenticated" });
  },
}));
