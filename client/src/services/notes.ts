import { api } from "./api";
import type { Note, NoteFolder } from "../types";

export const notesApi = {
  listFolders: () => api.get<{ folders: NoteFolder[] }>("/api/notes/folders"),
  createFolder: (data: { name: string; parentId?: string | null }) =>
    api.post<{ folder: NoteFolder }>("/api/notes/folders", data),
  updateFolder: (id: string, data: Partial<{ name: string; parentId: string | null }>) =>
    api.patch<{ folder: NoteFolder }>(`/api/notes/folders/${id}`, data),
  deleteFolder: (id: string) => api.delete(`/api/notes/folders/${id}`),

  list: (params?: { q?: string; folderId?: string | null }) =>
    api.get<{ notes: Note[]; sharedFolderPermission?: "read" | "write" }>(
      `/api/notes${params ? "?" + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      ).toString() : ""}`
    ),
  get: (id: string) => api.get<{ note: Note; sharedFolderPermission?: "read" | "write" }>(`/api/notes/${id}`),
  create: (data: Partial<Note>) => api.post<{ note: Note }>("/api/notes", data),
  update: (id: string, data: Partial<Note>) =>
    api.patch<{ note: Note }>(`/api/notes/${id}`, data),
  delete: (id: string) => api.delete(`/api/notes/${id}`),
};
