// ===== Demo account provisioning =====
// Provides a one-click "Try Demo" flow: a fresh, pre-seeded DEMO user is
// created on each request, authenticated with a dedicated admin-configured
// demo LLM, and cleaned up after a configurable TTL.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Cron } from "croner";
import prisma from "../db/client";
import { encryptSecret, decryptSecret } from "./crypto";
import { signToken, issueRefreshToken } from "./jwt";
import { resolveAndCache, type SourceDescriptor } from "./study/source";

const DEMO_ENABLED_KEY = "demo.enabled";
const DEMO_KEY_KEY = "demo.llm.key";
const DEMO_PROVIDER_KEY = "demo.llm.provider";
const DEMO_BASEURL_KEY = "demo.llm.baseUrl";
const DEMO_MODELID_KEY = "demo.llm.modelId";
const DEMO_TTL_KEY = "demo.ttlHours";
const DEMO_RPD_KEY = "demo.rateLimits.rpd";
const DEMO_RPM_KEY = "demo.rateLimits.rpm";

const DEFAULT_TTL_HOURS = 24;
const DEFAULT_DEMO_RPD = 100;
const DEFAULT_DEMO_RPM = 10;

async function getGlobalSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findFirst({ where: { userId: null, key } });
  return s?.value ?? null;
}

async function setGlobalSetting(key: string, value: string): Promise<void> {
  const existing = await prisma.setting.findFirst({ where: { userId: null, key } });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key, value } });
  }
}

export interface DemoConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  modelId: string;
  ttlHours: number;
  rateLimits: { rpd: number; rpm: number };
  /** True when an API key is configured. */
  hasKey: boolean;
}

/** Public-safe demo config (no decrypted key). */
export async function getDemoConfig(): Promise<DemoConfig> {
  const [enabled, keyEnc, provider, baseUrl, modelId, ttl, rpd, rpm] = await Promise.all([
    getGlobalSetting(DEMO_ENABLED_KEY),
    getGlobalSetting(DEMO_KEY_KEY),
    getGlobalSetting(DEMO_PROVIDER_KEY),
    getGlobalSetting(DEMO_BASEURL_KEY),
    getGlobalSetting(DEMO_MODELID_KEY),
    getGlobalSetting(DEMO_TTL_KEY),
    getGlobalSetting(DEMO_RPD_KEY),
    getGlobalSetting(DEMO_RPM_KEY),
  ]);
  return {
    enabled: enabled === "true",
    hasKey: Boolean(keyEnc),
    provider: provider ?? "openai",
    baseUrl: baseUrl ?? "",
    modelId: modelId ?? "",
    ttlHours: Number(ttl) || DEFAULT_TTL_HOURS,
    rateLimits: {
      rpd: Number(rpd) || DEFAULT_DEMO_RPD,
      rpm: Number(rpm) || DEFAULT_DEMO_RPM,
    },
  };
}

export interface DemoLlmSecrets {
  apiKey: string;
  provider: string;
  baseUrl?: string;
  modelId: string;
}

/** Decrypted demo LLM key, or null if not set. */
export async function getDemoLlmSecrets(): Promise<DemoLlmSecrets | null> {
  const keyEnc = await getGlobalSetting(DEMO_KEY_KEY);
  if (!keyEnc) return null;
  try {
    const apiKey = decryptSecret(keyEnc);
    if (!apiKey.trim()) return null;
    const [provider, baseUrl, modelId] = await Promise.all([
      getGlobalSetting(DEMO_PROVIDER_KEY),
      getGlobalSetting(DEMO_BASEURL_KEY),
      getGlobalSetting(DEMO_MODELID_KEY),
    ]);
    return {
      apiKey: apiKey.trim(),
      provider: provider?.trim() || "openai",
      baseUrl: baseUrl?.trim() || undefined,
      modelId: modelId?.trim() || "gpt-4o-mini",
    };
  } catch {
    return null;
  }
}

/** True when demo is enabled and an LLM key is configured. */
export async function isDemoReady(): Promise<boolean> {
  const cfg = await getDemoConfig();
  return cfg.enabled && cfg.hasKey;
}

export interface DemoConfigInput {
  enabled?: boolean;
  apiKey?: string;
  provider?: string;
  baseUrl?: string;
  modelId?: string;
  ttlHours?: number;
  rpd?: number;
  rpm?: number;
}

/** Save the demo config. An empty apiKey leaves the existing key untouched. */
export async function setDemoConfig(input: DemoConfigInput): Promise<DemoConfig> {
  if (input.enabled !== undefined) {
    await setGlobalSetting(DEMO_ENABLED_KEY, String(input.enabled));
  }
  if (input.apiKey?.trim()) {
    const enc = encryptSecret(input.apiKey.trim());
    await setGlobalSetting(DEMO_KEY_KEY, enc);
  }
  if (input.provider !== undefined) {
    await setGlobalSetting(DEMO_PROVIDER_KEY, input.provider.trim() || "openai");
  }
  if (input.baseUrl !== undefined) {
    await setGlobalSetting(DEMO_BASEURL_KEY, input.baseUrl.trim() || "");
  }
  if (input.modelId !== undefined) {
    await setGlobalSetting(DEMO_MODELID_KEY, input.modelId.trim() || "");
  }
  if (input.ttlHours !== undefined) {
    await setGlobalSetting(DEMO_TTL_KEY, String(input.ttlHours));
  }
  if (input.rpd !== undefined) {
    await setGlobalSetting(DEMO_RPD_KEY, String(input.rpd));
  }
  if (input.rpm !== undefined) {
    await setGlobalSetting(DEMO_RPM_KEY, String(input.rpm));
  }
  return getDemoConfig();
}

function randomDemoUsername(): string {
  return `demo-${randomBytes(8).toString("hex")}`;
}

function randomDemoPassword(): string {
  return randomBytes(24).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
}

export interface DemoUserResult {
  userId: string;
  username: string;
  token: string;
  refreshToken: string | null;
}

/** Create a fresh demo user, seed study data, and issue tokens. */
export async function createDemoUser(args: {
  deviceFingerprint?: string;
  deviceLabel?: string;
}): Promise<DemoUserResult> {
  const username = randomDemoUsername();
  const password = randomDemoPassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      displayName: "Demo Student",
      avatarColor: "#6366f1",
      role: "DEMO",
    },
  });

  await seedDemoData(user.id);

  const token = await signToken({ sub: user.id, username: user.username });
  let refreshToken: string | null = null;
  if (args.deviceFingerprint) {
    refreshToken = await issueRefreshToken({
      userId: user.id,
      deviceFingerprint: args.deviceFingerprint,
      deviceLabel: args.deviceLabel || "Demo browser",
    });
  }

  return { userId: user.id, username: user.username, token, refreshToken };
}

async function seedDemoData(userId: string) {
  // Notes folder + notes
  const folder = await prisma.noteFolder.create({
    data: { name: "Demo Notes", userId },
  });

  const note1 = await prisma.note.create({
    data: {
      title: "Introduction to Machine Learning",
      content: DEMO_ML_NOTE,
      tags: "demo,machine-learning,ai",
      userId,
      folderId: folder.id,
      pinned: true,
    },
  });
  const note2 = await prisma.note.create({
    data: {
      title: "The Water Cycle",
      content: DEMO_WATER_NOTE,
      tags: "demo,earth-science",
      userId,
      folderId: folder.id,
    },
  });
  const notes = [note1, note2];

  // Flashcard deck
  const deck = await prisma.flashcardDeck.create({
    data: {
      name: "ML Basics",
      description: "Key concepts from the demo ML note",
      color: "#6366f1",
      userId,
    },
  });
  await prisma.flashcard.createMany({
    data: [
      { deckId: deck.id, front: "What is supervised learning?", back: "Training a model on labeled input-output pairs so it can predict outputs for new inputs." },
      { deckId: deck.id, front: "What is overfitting?", back: "When a model learns the training data too closely, including noise, and performs poorly on new data." },
      { deckId: deck.id, front: "What is a feature in ML?", back: "An individual measurable property or characteristic of the data used by the model." },
      { deckId: deck.id, front: "Name three common types of ML.", back: "Supervised, unsupervised, and reinforcement learning." },
    ],
  });

  // Task workspace + tasks
  const taskWorkspace = await prisma.taskWorkspace.create({
    data: { name: "Demo Tasks", color: "#6366f1", userId },
  });
  await prisma.task.createMany({
    data: [
      { title: "Read the ML intro note", description: "Familiarize yourself with ML basics", status: "DONE", priority: "HIGH", userId, workspaceId: taskWorkspace.id, order: 0 },
      { title: "Generate flashcards from the ML note", description: "Use Study Hub → Flashcards", status: "TODO", priority: "HIGH", userId, workspaceId: taskWorkspace.id, order: 1 },
      { title: "Take the ML quiz", description: "Use Study Hub → Quiz Me", status: "TODO", priority: "MEDIUM", userId, workspaceId: taskWorkspace.id, order: 0 },
      { title: "Explore the water cycle summary", description: "Use Study Hub → Summarize", status: "TODO", priority: "MEDIUM", userId, workspaceId: taskWorkspace.id, order: 1 },
    ],
  });

  // Learning workspace backed by the notes as StudySources
  const sources: SourceDescriptor[] = notes.map((n) => ({ kind: "note", id: n.id }));
  const sourceIds: string[] = [];
  for (const src of sources) {
    try {
      const cached = await resolveAndCache(userId, src);
      sourceIds.push(cached.id);
    } catch (e) {
      console.error("[demo] failed to cache source:", e);
    }
  }

  if (sourceIds.length > 0) {
    await prisma.learningWorkspace.create({
      data: {
        userId,
        name: "Demo Workspace",
        description: "Sample sources to try Study Hub",
        color: "#6366f1",
        sourceIds: JSON.stringify(sourceIds),
      },
    });
  }
}

/** Delete demo users (and all cascaded data) older than the configured TTL. */
export async function cleanupOldDemoUsers(): Promise<number> {
  const cfg = await getDemoConfig();
  const ttlMs = cfg.ttlHours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - ttlMs);

  const old = await prisma.user.findMany({
    where: { role: "DEMO", createdAt: { lt: cutoff } },
    select: { id: true },
  });

  if (old.length === 0) return 0;

  await prisma.user.deleteMany({
    where: { id: { in: old.map((u) => u.id) } },
  });

  return old.length;
}

let cleanupCron: Cron | null = null;

/** Start the periodic demo-user cleanup job (idempotent). */
export function startDemoCleanup(): void {
  if (cleanupCron) return;
  // Run at startup and every hour.
  cleanupCron = new Cron("0 * * * *", async () => {
    try {
      const deleted = await cleanupOldDemoUsers();
      if (deleted > 0) {
        console.log(`[demo] cleaned up ${deleted} expired demo user(s)`);
      }
    } catch (e) {
      console.error("[demo] cleanup error:", e instanceof Error ? e.message : e);
    }
  });
  // Also run a first cleanup shortly after boot.
  setTimeout(() => {
    cleanupOldDemoUsers().catch((e) => console.error("[demo] initial cleanup error:", e instanceof Error ? e.message : e));
  }, 5000);
}

const DEMO_ML_NOTE = `# Introduction to Machine Learning

Machine learning (ML) is a branch of artificial intelligence where computers learn patterns from data instead of being explicitly programmed for every rule.

## Types of Machine Learning

### Supervised Learning
The model is trained on labeled examples: input-output pairs. After training, it can predict outputs for new, unseen inputs. Examples include spam filters, house price predictors, and image classifiers.

### Unsupervised Learning
The model finds hidden structure in unlabeled data. Common tasks include clustering customers into groups and reducing the dimensionality of complex datasets.

### Reinforcement Learning
An agent learns to make decisions by receiving rewards or penalties from an environment. It is used in game-playing AI, robotics, and recommendation systems.

## Key Concepts

- **Features**: The measurable properties used as input. For a house-price model, features might be square footage, number of bedrooms, and location.
- **Labels**: The target value we want to predict. In supervised learning, labels are the "answers" in the training data.
- **Training set / test set**: Data is split so the model learns on one portion and is evaluated on another to detect overfitting.
- **Overfitting**: The model memorizes the training data, including noise, and fails to generalize.
- **Underfitting**: The model is too simple to capture the underlying pattern.
- **Bias and variance**: Bias is error from overly simplistic assumptions; variance is error from sensitivity to small fluctuations in the training set.

## A Simple Example: Linear Regression

Given points (x, y), linear regression finds the line y = mx + b that best fits the data. The "best" line minimizes the total distance between the predictions and the actual y values, usually using a loss function such as mean squared error.

Gradient descent is a common algorithm for minimizing this loss: the model starts with random parameters and repeatedly adjusts them in the direction that reduces error.

## Why ML Matters for Students

- Automates tedious pattern-finding in large datasets.
- Powers tools you already use: search, translation, recommendation, and note-taking assistants.
- Builds a foundation for careers in data science, AI research, and software engineering.

## Common Misconceptions

1. ML is not magic — it requires good data and careful evaluation.
2. More data is not always better; quality, relevance, and balance matter.
3. A model that performs well on training data may still fail in the real world.
`;

const DEMO_WATER_NOTE = `# The Water Cycle

The water cycle, also known as the hydrologic cycle, describes the continuous movement of water on, above, and below Earth's surface.

## Main Processes

### Evaporation
The sun heats water in oceans, rivers, and lakes, turning it into water vapor that rises into the atmosphere.

### Transpiration
Plants release water vapor through pores in their leaves, adding moisture to the air.

### Condensation
As water vapor rises and cools, it changes back into tiny liquid droplets, forming clouds.

### Precipitation
When droplets combine and grow heavy, they fall as rain, snow, sleet, or hail.

### Collection
Water gathers in oceans, rivers, lakes, and groundwater reservoirs, continuing the cycle.

## Why It Matters

The water cycle regulates climate, distributes fresh water, and supports all living organisms. Understanding it helps explain weather patterns, droughts, floods, and the importance of conserving fresh water.
`;
