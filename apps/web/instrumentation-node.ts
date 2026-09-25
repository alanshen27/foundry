/**
 * Node-runtime half of instrumentation.ts.
 *
 * Kept in its own file because Next compiles instrumentation.ts for the edge
 * runtime as well, and webpack only drops an import from the edge build when
 * it sits inside an `if (process.env.NEXT_RUNTIME === "nodejs")` block. An
 * early `return` is not enough: the Sentry Node SDK was bundled for edge,
 * failed to resolve Node builtins, and every page in development returned 500.
 */

import type { Instrumentation } from "next";

export async function registerNode() {
  const { initObservability } = await import("@foundry/observability/sentry");
  const { createLogger } = await import("@foundry/observability");
  const { sentry } = initObservability({
    service: "foundry-web",
    sentryDsn: process.env.SENTRY_DSN?.trim() || undefined,
    environment: process.env.RENDER ? "production" : (process.env.NODE_ENV ?? "development"),
    release: process.env.RENDER_GIT_COMMIT,
  });
  const log = createLogger("diag");

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
    log.error(`${source}: ECONNREFUSED`, { detail, err });
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
  log.info("boot", { ...hosts, errorReporting: sentry ? "sentry" : "logs only" });
}

export async function onRequestErrorNode(
  ...[err, request, context]: Parameters<Instrumentation.onRequestError>
) {
  const { createLogger } = await import("@foundry/observability");
  createLogger("request").error("unhandled request error", {
    err,
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    digest: (err as { digest?: string } | undefined)?.digest,
  });
}
