export const ACTIVE_AI_RUN_STATUSES = ["PENDING", "RUNNING"] as const;

/**
 * Pending and running agents own the edit lease. Every terminal state releases
 * it, including failures and cancellation, so a stopped agent cannot strand a
 * workspace in read-only mode.
 */
export function holdsAiEditLock(status: string): boolean {
  return (ACTIVE_AI_RUN_STATUSES as readonly string[]).includes(status);
}
