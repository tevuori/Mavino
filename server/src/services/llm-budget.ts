import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../db/client";
import { getHostedBudgetConfig, roleToTier, type RateTier } from "./llm-config";

export interface BudgetSnapshot {
  tier: RateTier;
  limitMicros: number;
  spentMicros: number;
  reservedMicros: number;
  remainingMicros: number;
  resetAt: Date;
}

export interface BudgetReservation {
  requestId: string;
  amountMicros: number;
  snapshot: BudgetSnapshot;
}

function monthBounds(now = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function toSafeNumber(value: bigint | null | undefined): number {
  const number = Number(value ?? 0n);
  if (!Number.isSafeInteger(number)) throw new Error("LLM usage exceeds safe accounting range");
  return number;
}

export async function getBudgetSnapshot(userId: string): Promise<BudgetSnapshot> {
  const config = await getHostedBudgetConfig();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const tier = roleToTier(user?.role ?? "FREE");
  const { start, end } = monthBounds();
  const now = new Date();
  await prisma.llmBudgetReservation.updateMany({
    where: { userId, status: "active", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  const [usage, reservations] = await Promise.all([
    prisma.llmUsage.aggregate({
      where: { userId, source: "hosted", createdAt: { gte: start, lt: end } },
      _sum: { estimatedCostMicros: true },
    }),
    prisma.llmBudgetReservation.aggregate({
      where: { userId, status: "active", expiresAt: { gt: now } },
      _sum: { amountMicros: true },
    }),
  ]);
  const spentMicros = toSafeNumber(usage._sum.estimatedCostMicros);
  const reservedMicros = toSafeNumber(reservations._sum.amountMicros);
  const limitMicros = config.tiers[tier];
  return {
    tier,
    limitMicros,
    spentMicros,
    reservedMicros,
    remainingMicros: Math.max(0, limitMicros - spentMicros - reservedMicros),
    resetAt: end,
  };
}

export async function reserveHostedBudget(userId: string, requestedMicros?: number): Promise<BudgetReservation> {
  const config = await getHostedBudgetConfig();
  if (!config.enabled) throw new Error("HOSTED_DISABLED");
  const amountMicros = Math.min(requestedMicros ?? config.reservationMicros, config.maxOperationMicros);
  if (amountMicros <= 0) throw new Error("INVALID_BUDGET_RESERVATION");
  const requestId = randomUUID();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
        if (!user) throw new Error("USER_NOT_FOUND");
        const tier = roleToTier(user.role);
        const { start, end } = monthBounds();
        const now = new Date();
        await tx.llmBudgetReservation.updateMany({
          where: { status: "active", expiresAt: { lte: now } },
          data: { status: "expired" },
        });
        const [userUsage, userReservations, globalUsage, globalReservations] = await Promise.all([
          tx.llmUsage.aggregate({
            where: { userId, source: "hosted", createdAt: { gte: start, lt: end } },
            _sum: { estimatedCostMicros: true },
          }),
          tx.llmBudgetReservation.aggregate({
            where: { userId, status: "active", expiresAt: { gt: now } },
            _sum: { amountMicros: true },
          }),
          tx.llmUsage.aggregate({
            where: { source: "hosted", createdAt: { gte: start, lt: end } },
            _sum: { estimatedCostMicros: true },
          }),
          tx.llmBudgetReservation.aggregate({
            where: { status: "active", expiresAt: { gt: now } },
            _sum: { amountMicros: true },
          }),
        ]);
        const spentMicros = toSafeNumber(userUsage._sum.estimatedCostMicros);
        const reservedMicros = toSafeNumber(userReservations._sum.amountMicros);
        const limitMicros = config.tiers[tier];
        if (spentMicros + reservedMicros + amountMicros > limitMicros) throw new Error("BUDGET_EXHAUSTED");
        if (
          toSafeNumber(globalUsage._sum.estimatedCostMicros)
          + toSafeNumber(globalReservations._sum.amountMicros)
          + amountMicros
          > config.globalMonthlyMicros
        ) throw new Error("GLOBAL_BUDGET_EXHAUSTED");
        await tx.llmBudgetReservation.create({
          data: {
            userId,
            requestId,
            amountMicros: BigInt(amountMicros),
            expiresAt: new Date(now.getTime() + 15 * 60_000),
          },
        });
        return {
          requestId,
          amountMicros,
          snapshot: {
            tier,
            limitMicros,
            spentMicros,
            reservedMicros: reservedMicros + amountMicros,
            remainingMicros: Math.max(0, limitMicros - spentMicros - reservedMicros - amountMicros),
            resetAt: end,
          },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("BUDGET_RESERVATION_FAILED");
}

export async function settleBudgetReservation(requestId: string): Promise<void> {
  await prisma.llmBudgetReservation.updateMany({
    where: { requestId, status: "active" },
    data: { status: "settled", settledAt: new Date() },
  });
}

export async function releaseBudgetReservation(requestId: string): Promise<void> {
  await prisma.llmBudgetReservation.updateMany({
    where: { requestId, status: "active" },
    data: { status: "released" },
  });
}

export interface AdminUsageStats {
  monthStart: string;
  monthEnd: string;
  global: { limitMicros: number; spentMicros: number; reservedMicros: number; remainingMicros: number };
  totals: {
    requests: number;
    completed: number;
    estimated: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
  };
  byTier: Array<{ tier: RateTier; requests: number; costMicros: number }>;
  bySource: Array<{ source: string; requests: number; costMicros: number }>;
  byFeature: Array<{ feature: string; requests: number; costMicros: number }>;
  byModel: Array<{ provider: string; modelId: string; requests: number; costMicros: number }>;
  topUsers: Array<{ userId: string; username: string; tier: RateTier; requests: number; costMicros: number }>;
  daily: Array<{ day: string; requests: number; costMicros: number }>;
  reservations: { active: number; activeMicros: number };
}

export async function getAdminUsageStats(): Promise<AdminUsageStats> {
  const config = await getHostedBudgetConfig();
  const { start, end } = monthBounds();
  const now = new Date();
  await prisma.llmBudgetReservation.updateMany({
    where: { status: "active", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  const monthWhere = { createdAt: { gte: start, lt: end } };
  const [
    globalHosted,
    reservationAgg,
    totalsAgg,
    byStatus,
    bySource,
    byFeature,
    byModel,
    perUser,
    daily,
  ] = await Promise.all([
    prisma.llmUsage.aggregate({
      where: { ...monthWhere, source: "hosted" },
      _sum: { estimatedCostMicros: true },
    }),
    prisma.llmBudgetReservation.aggregate({
      where: { status: "active", expiresAt: { gt: now } },
      _sum: { amountMicros: true },
      _count: { _all: true },
    }),
    prisma.llmUsage.aggregate({
      where: monthWhere,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true },
    }),
    prisma.llmUsage.groupBy({
      by: ["status"],
      where: monthWhere,
      _count: { _all: true },
    }),
    prisma.llmUsage.groupBy({
      by: ["source"],
      where: monthWhere,
      _count: { _all: true },
      _sum: { estimatedCostMicros: true },
    }),
    prisma.llmUsage.groupBy({
      by: ["feature"],
      where: monthWhere,
      _count: { _all: true },
      _sum: { estimatedCostMicros: true },
    }),
    prisma.llmUsage.groupBy({
      by: ["provider", "modelId"],
      where: monthWhere,
      _count: { _all: true },
      _sum: { estimatedCostMicros: true },
    }),
    prisma.llmUsage.groupBy({
      by: ["userId"],
      where: { ...monthWhere, source: "hosted" },
      _count: { _all: true },
      _sum: { estimatedCostMicros: true },
    }),
    prisma.$queryRaw<Array<{ day: Date; requests: bigint; cost_micros: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::bigint AS requests,
             COALESCE(SUM("estimatedCostMicros"), 0)::bigint AS cost_micros
      FROM "LlmUsage"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const users = await prisma.user.findMany({
    where: { id: { in: perUser.map((row) => row.userId) } },
    select: { id: true, username: true, role: true },
  });
  const userById = new Map(users.map((user) => [user.id, user]));

  const tierMap = new Map<RateTier, { requests: number; costMicros: number }>();
  const topUsers = perUser
    .map((row) => {
      const user = userById.get(row.userId);
      const tier = roleToTier(user?.role ?? "FREE");
      const costMicros = toSafeNumber(row._sum.estimatedCostMicros);
      const requests = row._count._all;
      const bucket = tierMap.get(tier) ?? { requests: 0, costMicros: 0 };
      bucket.requests += requests;
      bucket.costMicros += costMicros;
      tierMap.set(tier, bucket);
      return { userId: row.userId, username: user?.username ?? "unknown", tier, requests, costMicros };
    })
    .sort((a, b) => b.costMicros - a.costMicros)
    .slice(0, 10);

  const statusCount = (name: string) => byStatus.find((row) => row.status === name)?._count._all ?? 0;
  const globalSpent = toSafeNumber(globalHosted._sum.estimatedCostMicros);
  const globalReserved = toSafeNumber(reservationAgg._sum.amountMicros);

  return {
    monthStart: start.toISOString(),
    monthEnd: end.toISOString(),
    global: {
      limitMicros: config.globalMonthlyMicros,
      spentMicros: globalSpent,
      reservedMicros: globalReserved,
      remainingMicros: Math.max(0, config.globalMonthlyMicros - globalSpent - globalReserved),
    },
    totals: {
      requests: totalsAgg._count._all,
      completed: statusCount("completed"),
      estimated: statusCount("estimated"),
      failed: statusCount("failed"),
      inputTokens: totalsAgg._sum.inputTokens ?? 0,
      outputTokens: totalsAgg._sum.outputTokens ?? 0,
      costMicros: toSafeNumber(totalsAgg._sum.estimatedCostMicros),
    },
    byTier: Array.from(tierMap.entries()).map(([tier, value]) => ({ tier, ...value })),
    bySource: bySource
      .map((row) => ({ source: row.source, requests: row._count._all, costMicros: toSafeNumber(row._sum.estimatedCostMicros) }))
      .sort((a, b) => b.costMicros - a.costMicros),
    byFeature: byFeature
      .map((row) => ({ feature: row.feature, requests: row._count._all, costMicros: toSafeNumber(row._sum.estimatedCostMicros) }))
      .sort((a, b) => b.costMicros - a.costMicros)
      .slice(0, 12),
    byModel: byModel
      .map((row) => ({ provider: row.provider, modelId: row.modelId, requests: row._count._all, costMicros: toSafeNumber(row._sum.estimatedCostMicros) }))
      .sort((a, b) => b.costMicros - a.costMicros)
      .slice(0, 12),
    topUsers,
    daily: daily.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      requests: toSafeNumber(row.requests),
      costMicros: toSafeNumber(row.cost_micros),
    })),
    reservations: {
      active: reservationAgg._count._all,
      activeMicros: globalReserved,
    },
  };
}
