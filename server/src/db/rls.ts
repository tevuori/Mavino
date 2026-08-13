// ===== Row-Level Security (RLS) Prisma extension =====
//
// Wraps every Prisma model operation in an interactive transaction that sets
// `app.current_user_id` and `app.is_admin` via SET LOCAL before the query.
// PostgreSQL RLS policies (see migration 20260813180000) use these variables
// to restrict rows to the authenticated user.
//
// The user context is propagated via AsyncLocalStorage, set by the auth
// middleware (runWithRls). When no context is set (auth flows, migrations,
// system queries), the extension is a no-op and RLS policies allow all access.
//
// For route-level $transaction calls, the extension intercepts the transaction
// and injects SET LOCAL at the start, so all queries within the transaction
// share the same RLS context without per-query overhead.

import { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

interface RlsContext {
  userId: string;
  isAdmin: boolean;
  /** Recursion guard — when > 0, skip the RLS wrapper. */
  depth: number;
}

const rlsStorage = new AsyncLocalStorage<RlsContext>();

/** Run a function within an RLS context. Set by authMiddleware. */
export function runWithRls<T>(userId: string, isAdmin: boolean, fn: () => Promise<T>): Promise<T> {
  return rlsStorage.run({ userId, isAdmin, depth: 0 }, fn);
}

/** Get the current RLS context (for admin middleware to set isAdmin). */
export function getRlsContext(): RlsContext | undefined {
  return rlsStorage.getStore();
}

/** Update the isAdmin flag on the current RLS context (used by adminGuard). */
export function setRlsAdmin(isAdmin: boolean): void {
  const ctx = rlsStorage.getStore();
  if (ctx) ctx.isAdmin = isAdmin;
}

/**
 * Prisma extension that enforces RLS by setting session variables before each
 * query. Apply to the base PrismaClient via `prisma.$extends(rlsExtension)`.
 */
export const rlsExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }) {
          const ctx = rlsStorage.getStore();

          // No RLS context (system/auth queries) — run directly.
          if (!ctx) return query(args);

          // Already inside an RLS-wrapped transaction — run directly.
          if (ctx.depth > 0) return query(args);

          // Intercept interactive $transaction calls — inject the RLS context
          // at the start so all queries inside share it without per-query overhead.
          if (operation === "$transaction" && Array.isArray(args) && typeof args[0] === "function") {
            const originalFn = args[0];
            args[0] = async (tx: any) => {
              await tx.$executeRaw`SELECT set_rls_context(${ctx.userId}, ${ctx.isAdmin})`;
              ctx.depth = 1;
              try {
                return await originalFn(tx);
              } finally {
                ctx.depth = 0;
              }
            };
            return query(args);
          }

          // Skip raw operations ($queryRaw, $executeRaw) and operations
          // without a model — these are system queries.
          if (!model || operation.startsWith("$")) return query(args);

          // Standalone model operation — wrap in a transaction with RLS context.
          ctx.depth++;
          try {
            return await (client as any).$transaction(async (tx: any) => {
              await tx.$executeRaw`SELECT set_rls_context(${ctx.userId}, ${ctx.isAdmin})`;
              return await tx[model][operation](args);
            });
          } finally {
            ctx.depth--;
          }
        },
      },
    },
  });
});
