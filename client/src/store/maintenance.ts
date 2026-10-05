import { create } from "zustand";
import { maintenanceApi, type MaintenanceStatus } from "../services/maintenance";

interface MaintenanceState {
  status: MaintenanceStatus | null;
  loading: boolean;
  load: () => Promise<void>;
  setStatus: (status: MaintenanceStatus) => void;
}

export const useMaintenance = create<MaintenanceState>((set) => ({
  status: null,
  loading: true,
  load: async () => {
    try {
      set({ status: await maintenanceApi.status(), loading: false });
    } catch {
      set({ loading: false });
    }
  },
  setStatus: (status) => set({ status, loading: false }),
}));

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startMaintenancePolling(): void {
  void useMaintenance.getState().load();
  if (pollTimer) return;
  pollTimer = setInterval(() => void useMaintenance.getState().load(), 15_000);
}

export function stopMaintenancePolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
