import "server-only";
import { createLogger } from "@foundry/observability";

const log = createLogger("readiness");

export type ReadinessCheck = () => Promise<unknown>;
export type ReadinessReport = {
  ok: boolean;
  checks: Record<string, "ok" | "error" | "timeout">;
};

const TIMEOUT = Symbol("timeout");

/** Runs every dependency probe in parallel; failure details stay in logs, not the response. */
export async function checkReadiness(
  checks: Record<string, ReadinessCheck>,
  timeoutMs = 3_000,
): Promise<ReadinessReport> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          check(),
          new Promise<typeof TIMEOUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
          }),
        ]);
        if (result === TIMEOUT) {
          log.warn("readiness check timed out", { check: name, timeoutMs });
          return [name, "timeout"] as const;
        }
        return [name, "ok"] as const;
      } catch (err) {
        log.warn("readiness check failed", { check: name, err });
        return [name, "error"] as const;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const report = Object.fromEntries(entries) as ReadinessReport["checks"];
  return { ok: entries.every(([, status]) => status === "ok"), checks: report };
}
