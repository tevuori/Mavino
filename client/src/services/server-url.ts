export const PLAY_SERVER_URL = "https://mavino.net";

export function resolveServerUrl(isNative: boolean, isPlayBuild: boolean, storedUrl: string | null): string {
  if (!isNative) return "";
  if (isPlayBuild) return PLAY_SERVER_URL;
  return storedUrl?.replace(/\/+$/, "") ?? "";
}
