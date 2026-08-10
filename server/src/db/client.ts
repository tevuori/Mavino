import { PrismaClient } from "@prisma/client";

// Prevent Bun's --hot HMR from creating a new PrismaClient (and its connection
// pool) on every file save. Without this, each hot reload leaks ~num_cpus*2+1
// connections until PostgreSQL's max_connections limit is exhausted
// ("FATAL: sorry, too many clients already"). The global cache survives soft
// reloads because globalThis is not re-evaluated.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
export type { PrismaClient } from "@prisma/client";
