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
