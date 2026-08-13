import { PrismaClient } from "@prisma/client";
import { rlsExtension } from "./rls";

// Prevent Bun's --hot HMR from creating a new PrismaClient (and its connection
// pool) on every file save. Without this, each hot reload leaks ~num_cpus*2+1
// connections until PostgreSQL's max_connections limit is exhausted
// ("FATAL: sorry, too many clients already"). The global cache survives soft
// reloads because globalThis is not re-evaluated.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Apply the RLS extension — wraps each model operation in a transaction
// that sets app.current_user_id + app.is_admin via SET LOCAL.
const baseClient = globalForPrisma.prisma ?? new PrismaClient();
const prisma = baseClient.$extends(rlsExtension) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = baseClient;
}

export default prisma;
export type { PrismaClient } from "@prisma/client";
