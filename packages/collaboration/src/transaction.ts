/**
 * Collaborative saves hold SQL/advisory locks while updating the read model and
 * durable Yjs state together. On a hosted database, several parallel tool writes
 * can spend Prisma's default five-second lifetime just waiting for their turn.
 * Keep a finite budget for that lock wait plus the SQL round trips; never move
 * network calls into these transactions or split the two representations.
 */
export const COLLABORATION_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;
