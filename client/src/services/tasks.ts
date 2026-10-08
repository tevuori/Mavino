import { api } from "./api";
import type { Task, TaskStatus, TaskPriority } from "../types";

export const tasksApi = {
  list: (workspaceId?: string) =>
    api.get<{ tasks: Task[] }>(
      workspaceId ? `/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}` : "/api/tasks"
    ),
  create: (data: Partial<Task>) => api.post<{ task: Task }>("/api/tasks", data),
  update: (id: string, data: Partial<Task>) =>
    api.patch<{ task: Task }>(`/api/tasks/${id}`, data),
  delete: (id: string) => api.delete(`/api/tasks/${id}`),
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

export const STATUS_ORDER: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: "bg-surface-3",
  MEDIUM: "bg-warning",
  HIGH: "bg-danger",
};
