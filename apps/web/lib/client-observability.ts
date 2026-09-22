"use client";

/**
 * Browser half of @foundry/observability.
 *
 * Imported once by the root client provider, so every client module that
 * calls `createLogger(...).error(...)` has its error relayed to
 * /api/client-errors — the same place the error boundaries report to — rather
 * than living and dying in one person's devtools.
 *
 * Browser consoles are read by people, so lines stay readable, and production
 * drops debug/info chatter.
 */

import { configureObservability } from "@foundry/observability";
import { reportClientError } from "@/lib/report-client-error";

if (typeof window !== "undefined") {
  configureObservability({
    service: "foundry-browser",
    format: "pretty",
    minLevel: process.env.NODE_ENV === "production" ? "warn" : "debug",
    reporter: { capture: (error) => reportClientError(error, "manual") },
  });
}

export {};
