import type { AppId } from "../../store/windows";

export interface TeachLaunchInput {
  appId: AppId;
  title: string;
  icon: string;
  payload?: Record<string, unknown>;
}

export function teachLaunchInput(sessionId?: string | null): TeachLaunchInput {
  return {
    appId: "teach",
    title: "Teach Me",
    icon: "Presentation",
    payload: sessionId ? { sessionId } : undefined,
  };
}
