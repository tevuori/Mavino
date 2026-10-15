import prisma from "../db/client";

export interface OpenTestingConfig {
  enabled: boolean;
  open: boolean;
  maxActiveTesters: number;
  waitlistMessage: string;
}

const DEFAULT_CONFIG: OpenTestingConfig = {
  enabled: false,
  open: false,
  maxActiveTesters: 100,
  waitlistMessage: "Open testing is currently full. We'll email you when a spot opens up.",
};

const CONFIG_KEYS: (keyof OpenTestingConfig)[] = [
  "enabled",
  "open",
  "maxActiveTesters",
  "waitlistMessage",
];

async function getGlobalSetting(key: string): Promise<string | undefined> {
  const row = await prisma.setting.findFirst({
    where: { userId: null, key: `openTesting.${key}` },
  });
  return row?.value;
}

export async function getOpenTestingConfig(): Promise<OpenTestingConfig> {
  const [enabledRaw, openRaw, maxRaw, messageRaw] = await Promise.all(
    CONFIG_KEYS.map((k) => getGlobalSetting(k))
  );

  return {
    enabled: enabledRaw === "true",
    open: openRaw === "true",
    maxActiveTesters: Math.max(0, Number(maxRaw) || DEFAULT_CONFIG.maxActiveTesters),
    waitlistMessage: messageRaw ?? DEFAULT_CONFIG.waitlistMessage,
  };
}

export async function setOpenTestingConfig(
  patch: Partial<OpenTestingConfig>
): Promise<OpenTestingConfig> {
  for (const [key, value] of Object.entries(patch)) {
    const stringValue = typeof value === "boolean" ? String(value) : String(value ?? "");
    const existing = await prisma.setting.findFirst({
      where: { userId: null, key: `openTesting.${key}` },
    });
    if (existing) {
      await prisma.setting.update({
        where: { id: existing.id },
        data: { value: stringValue },
      });
    } else {
      await prisma.setting.create({
        data: { userId: null, key: `openTesting.${key}`, value: stringValue },
      });
    }
  }
  return getOpenTestingConfig();
}

/**
 * Count active testers created through open testing.
 */
export async function countActiveTesters(): Promise<number> {
  return prisma.openTestingInvite.count({
    where: { status: "USED", userId: { not: null } },
  });
}

export async function isAtCapacity(config?: OpenTestingConfig): Promise<boolean> {
  const cfg = config ?? (await getOpenTestingConfig());
  if (!cfg.enabled || cfg.maxActiveTesters <= 0) return false;
  const active = await countActiveTesters();
  return active >= cfg.maxActiveTesters;
}

export async function isOpenForInvites(): Promise<boolean> {
  const config = await getOpenTestingConfig();
  if (!config.enabled || !config.open) return false;
  return !(await isAtCapacity(config));
}
