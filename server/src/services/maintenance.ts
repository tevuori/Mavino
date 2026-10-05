import prisma from "../db/client";

const SETTING_KEY = "maintenance.config";
const DEFAULT_MESSAGE = "Mavino is temporarily unavailable while maintenance is in progress.";
const CACHE_MS = 1_000;

export interface MaintenanceConfig {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  message: string;
}

export interface MaintenanceStatus extends MaintenanceConfig {
  active: boolean;
  scheduled: boolean;
  serverTime: string;
  retryAfterSeconds: number | null;
}

const DEFAULT_CONFIG: MaintenanceConfig = {
  enabled: false,
  startsAt: null,
  endsAt: null,
  message: DEFAULT_MESSAGE,
};

let cached: { config: MaintenanceConfig; expiresAt: number } | null = null;

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseMaintenanceConfig(value: string | null | undefined): MaintenanceConfig {
  if (!value) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      enabled: parsed.enabled === true,
      startsAt: validDate(parsed.startsAt),
      endsAt: validDate(parsed.endsAt),
      message:
        typeof parsed.message === "string" && parsed.message.trim()
          ? parsed.message.trim().slice(0, 500)
          : DEFAULT_MESSAGE,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function evaluateMaintenance(
  config: MaintenanceConfig,
  now = new Date()
): MaintenanceStatus {
  const nowMs = now.getTime();
  const startMs = config.startsAt ? new Date(config.startsAt).getTime() : nowMs;
  const endMs = config.endsAt ? new Date(config.endsAt).getTime() : null;
  const scheduled = config.enabled && startMs > nowMs;
  const active = config.enabled && !scheduled && (endMs === null || endMs > nowMs);
  const retryAfterSeconds =
    active && endMs !== null ? Math.max(1, Math.ceil((endMs - nowMs) / 1_000)) : null;
  return {
    ...config,
    active,
    scheduled,
    serverTime: now.toISOString(),
    retryAfterSeconds,
  };
}

export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  const setting = await prisma.setting.findFirst({
    where: { userId: null, key: SETTING_KEY },
    select: { value: true },
  });
  const config = parseMaintenanceConfig(setting?.value);
  cached = { config, expiresAt: Date.now() + CACHE_MS };
  return config;
}

export async function getMaintenanceStatus(now = new Date()): Promise<MaintenanceStatus> {
  return evaluateMaintenance(await getMaintenanceConfig(), now);
}

export async function saveMaintenanceConfig(config: MaintenanceConfig): Promise<MaintenanceConfig> {
  const normalized: MaintenanceConfig = {
    enabled: config.enabled,
    startsAt: validDate(config.startsAt),
    endsAt: validDate(config.endsAt),
    message: config.message.trim().slice(0, 500) || DEFAULT_MESSAGE,
  };
  const existing = await prisma.setting.findFirst({
    where: { userId: null, key: SETTING_KEY },
    select: { id: true },
  });
  const value = JSON.stringify(normalized);
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key: SETTING_KEY, value } });
  }
  cached = { config: normalized, expiresAt: Date.now() + CACHE_MS };
  return normalized;
}

export async function disableMaintenance(): Promise<MaintenanceConfig> {
  const current = await getMaintenanceConfig();
  return saveMaintenanceConfig({ ...current, enabled: false, startsAt: null, endsAt: null });
}

export function clearMaintenanceCache(): void {
  cached = null;
}
