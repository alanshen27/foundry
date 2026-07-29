import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Always pin on globalThis. Next.js can evaluate this module more than once
 * across server bundles; without a singleton, prod opens many Postgres
 * connections and every query feels like cold `next dev`.
 */
export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();
globalForPrisma.prisma = prisma;

export * from "@prisma/client";
