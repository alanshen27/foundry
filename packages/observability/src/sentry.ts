/**
 * Sentry adapter for the error reporter port.
 *
 * Imported only by server entry points, and only initialises when a DSN is
 * configured — so local development, CI and a fresh clone never talk to
 * Sentry, and nothing outside this file knows Sentry exists.
 */

import * as Sentry from "@sentry/node";
import { configureObservability, type ErrorReporter } from "./index";

export type SentryOptions = {
  dsn: string;
  /** e.g. "foundry-web", "foundry-chat-worker". Becomes a tag. */
  service: string;
  environment?: string;
  release?: string;
  /** 0–1. Errors are always sent; this samples performance traces. */
  tracesSampleRate?: number;
};

let initialised = false;

export function createSentryReporter(options: SentryOptions): ErrorReporter {
  if (!initialised) {
    Sentry.init({
      dsn: options.dsn,
      environment: options.environment,
      release: options.release,
      tracesSampleRate: options.tracesSampleRate ?? 0,
      initialScope: { tags: { service: options.service } },
      // Request bodies can hold prompts, brief text and credentials. Never
      // attach them by default; context is added deliberately per report.
      sendDefaultPii: false,
    });
    initialised = true;
  }

  return {
    capture(error, context) {
      Sentry.withScope((scope) => {
        scope.setTag("scope", context.scope);
        scope.setLevel(context.level === "warning" ? "warning" : "error");
        if (context.message) scope.setExtra("message", context.message);
        if (context.fields) {
          for (const [key, value] of Object.entries(context.fields)) {
            // Ids make the best tags: they are what someone searches by.
            if (/Id$/.test(key) && typeof value === "string") scope.setTag(key, value);
            else scope.setExtra(key, value);
          }
        }
        Sentry.captureException(error);
      });
    },
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
  };
}

/**
 * One call per process entry point. Returns whether Sentry is active, so the
 * boot log can say so plainly rather than leaving someone to wonder.
 */
export function initObservability(options: {
  service: string;
  sentryDsn?: string;
  environment?: string;
  release?: string;
}): { sentry: boolean } {
  configureObservability({ service: options.service });
  if (!options.sentryDsn) return { sentry: false };
  configureObservability({
    reporter: createSentryReporter({
      dsn: options.sentryDsn,
      service: options.service,
      environment: options.environment,
      release: options.release,
    }),
  });
  return { sentry: true };
}
