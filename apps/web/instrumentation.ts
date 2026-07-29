/**
 * Node-only boot hooks. Logs the real host:port behind AggregateError ECONNREFUSED
 * (Node dual-stacks localhost into an empty AggregateError otherwise).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  const describe = (err: unknown) => {
    if (!err || typeof err !== "object") return String(err);
    const e = err as AggregateError & {
      code?: string;
      address?: string;
      port?: number;
      errors?: unknown[];
      cause?: unknown;
      message?: string;
    };
    if (e.code !== "ECONNREFUSED" && e.name !== "AggregateError") return null;

    const parts: string[] = [];
    if (e.address || e.port) parts.push(`${e.address ?? "?"}:${e.port ?? "?"}`);
    if (Array.isArray(e.errors)) {
      for (const nested of e.errors) {
        if (!nested || typeof nested !== "object") continue;
        const n = nested as { address?: string; port?: number; code?: string };
        parts.push(`${n.address ?? "?"}:${n.port ?? "?"} (${n.code ?? "?"})`);
      }
    }
    return parts.length ? parts.join(" | ") : e.message || e.code || "ECONNREFUSED";
  };

  const logRefused = (source: string, err: unknown) => {
    const detail = describe(err);
    if (!detail) return;
    console.error(`[diag:${source}] ECONNREFUSED → ${detail}`);
  };

  process.on("unhandledRejection", (reason) => {
    logRefused("unhandledRejection", reason);
  });
  process.on("uncaughtException", (err) => {
    logRefused("uncaughtException", err);
  });

  // Safe boot summary (no secrets)
  const hosts = {
    RENDER: process.env.RENDER ?? "(unset)",
    SUPABASE: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(unset)",
    REDIS: process.env.REDIS_URL
      ? (() => {
          try {
            return new URL(process.env.REDIS_URL!).host;
          } catch {
            return "(invalid REDIS_URL)";
          }
        })()
      : "(unset → defaults to localhost:6379)",
    COLLAB: process.env.NEXT_PUBLIC_COLLAB_URL ?? "(unset)",
    DATABASE: process.env.DATABASE_URL
      ? (() => {
          try {
            return new URL(process.env.DATABASE_URL!).host;
          } catch {
            return "(invalid DATABASE_URL)";
          }
        })()
      : "(unset)",
  };
  console.log("[diag:boot]", JSON.stringify(hosts));
}
