import { api, getToken } from "./api";
import type { VFile, VFolder, FolderTreeNode, StorageInfo } from "../types";

export const filesApi = {
  // ---- Folders ----
  listFolders: (parentId?: string | null) =>
    api.get<{ folders: VFolder[] }>(
      `/api/files/folders${parentId !== undefined ? `?parentId=${parentId === null ? "null" : parentId}` : ""}`
    ),
  createFolder: (data: { name: string; parentId?: string | null }) =>
    api.post<{ folder: VFolder }>("/api/files/folders", data),
  deleteFolder: (id: string) => api.delete(`/api/files/folders/${id}`),
  renameFolder: (id: string, name: string) =>
    api.patch(`/api/files/folders/${id}`, { name }),
  moveFolder: (id: string, parentId: string | null) =>
    api.patch(`/api/files/folders/${id}/move`, { parentId }),
  zipFolder: (id: string) => api.raw(`/api/files/folders/${id}/zip`, { method: "POST" }),

  // ---- Files ----
  list: (folderId?: string | null) =>
    api.get<{ files: VFile[] }>(
      `/api/files${folderId !== undefined ? `?folderId=${folderId === null ? "null" : folderId}` : ""}`
    ),
  all: (params?: { q?: string; starred?: boolean; recent?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.starred) qs.set("starred", "true");
    if (params?.recent) qs.set("recent", "true");
    const s = qs.toString();
    return api.get<{ files: VFile[] }>(`/api/files/all${s ? `?${s}` : ""}`);
  },
  tree: () => api.get<{ folders: VFolder[]; fileCounts: Record<string, number> }>(`/api/files/tree`),
  storage: () => api.get<StorageInfo>(`/api/files/storage`),
  upload: (file: File, folderId?: string | null) => {
    const fd = new FormData();
    fd.append("file", file);
    if (folderId) fd.append("folderId", folderId);
    return api.post<{ file: VFile }>("/api/files/upload", fd);
  },
  createText: (data: { name: string; folderId?: string | null; content?: string }) =>
    api.post<{ file: VFile }>("/api/files/text", { content: "", ...data }),
  downloadUrl: (id: string) => {
    const token = getToken();
    return `/api/files/${id}/download${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  },
  download: (id: string) => api.raw(`/api/files/${id}/download`),
  getContent: (id: string) =>
    api.get<{ content: string; name: string; mimeType: string }>(`/api/files/${id}/content`),
  saveContent: (id: string, content: string) =>
    api.put<{ file: VFile }>(`/api/files/${id}/content`, { content }),
  markOpened: (id: string) => api.post(`/api/files/${id}/opened`, {}),
  rename: (id: string, name: string) => api.patch(`/api/files/${id}`, { name }),
  move: (id: string, folderId: string | null) =>
    api.patch(`/api/files/${id}/move`, { folderId }),
  duplicate: (id: string) => api.post<{ file: VFile }>(`/api/files/duplicate/${id}`, {}),
  toggleStar: (id: string) => api.post<{ file: VFile }>(`/api/files/${id}/star`, {}),
  zip: (fileIds: string[]) =>
    api.raw(`/api/files/zip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds }) }),
  delete: (id: string) => api.delete(`/api/files/${id}`),
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function fileIconColor(mime: string): string {
  if (mime.startsWith("image/")) return "text-green-400";
  if (mime === "application/pdf") return "text-red-400";
  if (mime.startsWith("text/")) return "text-blue-400";
  if (mime.startsWith("audio/")) return "text-purple-400";
  if (mime.startsWith("video/")) return "text-pink-400";
  if (mime.includes("zip") || mime.includes("compressed")) return "text-amber-400";
  return "text-ink-muted";
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "json5",
  "html", "htm", "css", "scss", "sass", "less", "xml", "svg", "py", "rb", "php",
  "go", "rs", "java", "c", "h", "cpp", "hpp", "cc", "cs", "kt", "swift", "sh",
  "bash", "zsh", "fish", "ps1", "yml", "yaml", "toml", "ini", "cfg", "conf",
  "env", "gitignore", "sql", "graphql", "gql", "vue", "svelte", "astro", "lua",
  "pl", "r", "dart", "scala", "clj", "ex", "exs", "erl", "hs", "ml", "nim", "v",
  "zig", "makefile", "dockerfile", "tf", "hcl", "log", "csv", "tsv", "diff",
  "patch", "lock", "editorconfig", "prettierrc", "eslintrc",
]);

export function isTextFile(file: Pick<VFile, "name" | "mimeType">): boolean {
  const { mimeType, name } = file;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json" || mimeType === "application/xml" ||
      mimeType === "application/javascript" || mimeType === "application/x-sh" ||
      mimeType.includes("yaml") || mimeType.includes("csv")) return true;
  const ext = extOf(name);
  if (TEXT_EXT.has(ext)) return true;
  const base = name.toLowerCase();
  if (base === "makefile" || base === "dockerfile" || base.startsWith(".")) return true;
  return false;
}

export function isImageFile(file: Pick<VFile, "mimeType" | "name">): boolean {
  return file.mimeType.startsWith("image/");
}

export function isPdfFile(file: Pick<VFile, "mimeType" | "name">): boolean {
  return file.mimeType === "application/pdf" || extOf(file.name) === "pdf";
}

export function isAudioFile(file: Pick<VFile, "mimeType" | "name">): boolean {
  if (file.mimeType.startsWith("audio/")) return true;
  const ext = extOf(file.name);
  return ["mp3", "wav", "ogg", "flac", "aac", "m4a", "opus", "weba"].includes(ext);
}

export function isVideoFile(file: Pick<VFile, "mimeType" | "name">): boolean {
  if (file.mimeType.startsWith("video/")) return true;
  const ext = extOf(file.name);
  return ["mp4", "webm", "mov", "mkv", "avi", "ogv", "m4v"].includes(ext);
}

export function isMarkdownFile(file: Pick<VFile, "mimeType" | "name">): boolean {
  return file.mimeType === "text/markdown" || ["md", "markdown"].includes(extOf(file.name));
}

/** Decide which app window opens a file on double-click. */
export function openTargetForFile(file: Pick<VFile, "name" | "mimeType">): "editor" | "viewer" {
  if (isTextFile(file)) return "editor";
  if (isImageFile(file) || isPdfFile(file) || isAudioFile(file) || isVideoFile(file)) return "viewer";
  return "viewer";
}

/** Build a folder tree from a flat folder list + file count map. */
export function buildFolderTree(
  folders: VFolder[],
  fileCounts: Record<string, number>
): FolderTreeNode[] {
  const byParent = new Map<string | null, VFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const build = (parentId: string | null): FolderTreeNode[] =>
    (byParent.get(parentId) ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      children: build(f.id),
      fileCount: fileCounts[f.id] ?? 0,
    }));
  return build(null);
}
