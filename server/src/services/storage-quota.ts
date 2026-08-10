// ===== Storage quota configuration =====
// Admins can set a per-role storage cap on user-uploaded files. When a cap
// is enabled, every operation that writes to the uploads/ directory checks
// the user's current usage (from VFile records with a physical storage key)
// before allowing the write. Disabled caps mean unlimited storage for that
// role. Quotas are stored as JSON in the global Setting table (userId = null)
// under keys like `storage.quota.FREE`.

import prisma from "../db/client";

export interface StorageQuota {
  enabled: boolean;
  maxBytes: number;
}

const ROLES = ["FREE", "PAID", "MANAGER", "ADMIN", "DEMO"] as const;

const DEFAULT_QUOTAS: Record<string, StorageQuota> = {
  FREE: { enabled: true, maxBytes: 500 * 1024 * 1024 },
  PAID: { enabled: true, maxBytes: 2 * 1024 * 1024 * 1024 },
  MANAGER: { enabled: false, maxBytes: 0 },
  ADMIN: { enabled: false, maxBytes: 0 },
  DEMO: { enabled: true, maxBytes: 500 * 1024 * 1024 },
};

function settingKey(role: string): string {
  return `storage.quota.${role}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Get the configured quota for a role, falling back to defaults. */
export async function getQuota(role: string): Promise<StorageQuota> {
  const row = await prisma.setting.findFirst({
    where: { userId: null, key: settingKey(role) },
  });
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as Partial<StorageQuota>;
      return {
        enabled: Boolean(parsed.enabled),
        maxBytes: Math.max(0, Number(parsed.maxBytes) || 0),
      };
    } catch {
      /* fall through to defaults */
    }
  }
  return DEFAULT_QUOTAS[role] ?? { enabled: false, maxBytes: 0 };
}

/** Persist a quota for a role. */
export async function setQuota(role: string, quota: StorageQuota): Promise<void> {
  const value = JSON.stringify({
    enabled: Boolean(quota.enabled),
    maxBytes: Math.max(0, Number(quota.maxBytes) || 0),
  });
  const existing = await prisma.setting.findFirst({
    where: { userId: null, key: settingKey(role) },
  });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key: settingKey(role), value } });
  }
}

/** Get quotas for all known roles. */
export async function listQuotas(): Promise<Array<{ role: string } & StorageQuota>> {
  return Promise.all(
    ROLES.map(async (role) => {
      const q = await getQuota(role);
      return { role, ...q };
    })
  );
}

/** Get the role and quota for a specific user. */
export async function getUserQuota(
  userId: string
): Promise<{ role: string } & StorageQuota> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = user?.role || "FREE";
  const q = await getQuota(role);
  return { role, ...q };
}

/** Sum of on-disk file sizes for a user (excludes virtual/external files). */
export async function getUserStorageUsage(userId: string): Promise<number> {
  const agg = await prisma.vFile.aggregate({
    where: {
      userId,
      storageKey: { not: "" },
      source: { not: "moodle" },
    },
    _sum: { size: true },
  });
  return agg._sum.size ?? 0;
}

export interface StorageStatus {
  allowed: boolean;
  used: number;
  limit: number | null;
  role: string;
  enabled: boolean;
  message: string;
}

/**
 * Check whether adding `additionalBytes` would exceed the user's quota.
 * `additionalBytes` may be negative (e.g. when overwriting a smaller file).
 */
export async function getStorageStatus(
  userId: string,
  additionalBytes = 0
): Promise<StorageStatus> {
  const { role, enabled, maxBytes } = await getUserQuota(userId);
  const used = await getUserStorageUsage(userId);

  if (!enabled || maxBytes <= 0) {
    return { allowed: true, used, limit: null, role, enabled: false, message: "" };
  }

  if (used + additionalBytes > maxBytes) {
    const projected = used + additionalBytes;
    const over = projected - maxBytes;
    const message =
      `Storage quota exceeded for the ${role} plan. ` +
      `Currently using ${formatBytes(used)} of ${formatBytes(maxBytes)}. ` +
      `This operation would exceed the quota by ${formatBytes(over)}.`;
    return { allowed: false, used, limit: maxBytes, role, enabled: true, message };
  }

  return { allowed: true, used, limit: maxBytes, role, enabled: true, message: "" };
}
