/**
 * Logging and error reporting for every FOUNDRY process — web, chat worker,
 * collab server.
 *
 * Two jobs, deliberately kept apart:
 *
 * - A structured logger. JSON lines in production, so a log drain can filter
 *   by run id instead of grepping prefixes out of free text; readable
 *   single lines in development, because nobody reads JSON in a terminal.
 * - An error reporter port. Errors logged at `error` level, and anything
 *   passed to `reportError`, go to whichever reporter is installed. The
 *   default only logs; `./sentry` installs Sentry when a DSN is configured.
 *   Vendor code stays behind the port, per AGENTS.md.
 *
 * Before this, failures in production were discoverable only by reading
 * Render's log tail for a bracketed prefix. Nothing alerted, nothing grouped,
 * and nothing counted how often a copilot run died.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  /** Also reported to the installed error reporter. */
  error: (message: string, fields?: LogFields) => void;
  /** A logger whose every line carries these fields, e.g. `{ runId }`. */
  child: (bindings: LogFields) => Logger;
};

export type ErrorContext = {
  scope: string;
  message?: string;
  fields?: LogFields;
  level?: "error" | "warning";
};

export interface ErrorReporter {
  capture(error: unknown, context: ErrorContext): void;
  /** Waits for queued reports to send, for processes about to exit. */
  flush?(timeoutMs: number): Promise<boolean>;
}

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedError | string;
  errors?: (SerializedError | string)[];
};

// ---------- configuration ----------

type Format = "json" | "pretty";

const state: {
  service: string;
  format: Format;
  minLevel: LogLevel;
  reporter: ErrorReporter;
  sink: (level: LogLevel, line: string) => void;
} = {
  service: "foundry",
  format: defaultFormat(),
  minLevel: defaultMinLevel(),
  reporter: { capture: () => {} },
  sink: consoleSink,
};

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function defaultFormat(): Format {
  const explicit = env("LOG_FORMAT");
  if (explicit === "json" || explicit === "pretty") return explicit;
  return env("NODE_ENV") === "production" ? "json" : "pretty";
}

function defaultMinLevel(): LogLevel {
  const explicit = env("LOG_LEVEL");
  if (explicit === "debug" || explicit === "info" || explicit === "warn" || explicit === "error") {
    return explicit;
  }
  // Debug lines are for local work; production keeps info and up.
  return env("NODE_ENV") === "production" ? "info" : "debug";
}

function consoleSink(level: LogLevel, line: string) {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function configureObservability(options: {
  service?: string;
  format?: Format;
  minLevel?: LogLevel;
  reporter?: ErrorReporter;
  /** Replaces console output. Tests use it; nothing else should need to. */
  sink?: (level: LogLevel, line: string) => void;
}) {
  if (options.service) state.service = options.service;
  if (options.format) state.format = options.format;
  if (options.minLevel) state.minLevel = options.minLevel;
  if (options.reporter) state.reporter = options.reporter;
  if (options.sink) state.sink = options.sink;
}

export function getErrorReporter(): ErrorReporter {
  return state.reporter;
}

// ---------- errors ----------

/**
 * Turns anything thrown into plain, JSON-safe data.
 *
 * `JSON.stringify(new Error("x"))` is `{}`, which is how most "error: {}" log
 * lines happen. AggregateError is expanded because Node reports a refused
 * dual-stack connection as an AggregateError with an empty message and the
 * real addresses buried in `.errors` — the exact failure that used to look
 * like a silent crash loop on Render.
 */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: typeof error === "string" ? error : safeString(error) };
  }
  const out: SerializedError = { name: error.name, message: error.message };
  if (error.stack) out.stack = error.stack;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") out.code = String(code);
  if (depth < 3) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      out.cause = cause instanceof Error ? serializeError(cause, depth + 1) : safeString(cause);
    }
    const nested = (error as { errors?: unknown }).errors;
    if (Array.isArray(nested) && nested.length > 0) {
      out.errors = nested
        .slice(0, 10)
        .map((e) => (e instanceof Error ? serializeError(e, depth + 1) : safeString(e)));
    }
  }
  return out;
}

function safeString(value: unknown): string {
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
}

/** Reports an error without logging it — for callers that already logged. */
export function reportError(error: unknown, context: ErrorContext) {
  try {
    state.reporter.capture(error, context);
  } catch {
    // A broken reporter must never take down the code path that was
    // reporting; the log line has already been written.
  }
}

// ---------- logging ----------

/** Finds the thrown value among a line's fields, by convention `err` or `error`. */
function errorIn(fields: LogFields | undefined): unknown {
  if (!fields) return undefined;
  if (fields.err !== undefined) return fields.err;
  if (fields.error instanceof Error) return fields.error;
  return undefined;
}

function normalizeFields(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function prettyValue(value: unknown): string {
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  if (value && typeof value === "object" && "message" in value && "name" in value) {
    const e = value as SerializedError;
    return JSON.stringify(`${e.name}: ${e.message}`);
  }
  return safeString(value);
}

export function formatLine(
  format: Format,
  level: LogLevel,
  scope: string,
  message: string,
  fields: LogFields | undefined,
  now: Date = new Date(),
): string {
  if (format === "json") {
    return safeString({
      time: now.toISOString(),
      level,
      service: state.service,
      scope,
      message,
      ...fields,
    });
  }
  const time = now.toISOString().slice(11, 19);
  const extras = fields
    ? Object.entries(fields)
        .map(([k, v]) => `${k}=${prettyValue(v)}`)
        .join(" ")
    : "";
  const stack =
    fields && typeof (fields.err as SerializedError | undefined)?.stack === "string"
      ? `\n${(fields.err as SerializedError).stack}`
      : "";
  return `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extras ? ` ${extras}` : ""}${stack}`;
}

function emit(level: LogLevel, scope: string, message: string, fields?: LogFields) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[state.minLevel]) return;
  const thrown = errorIn(fields);
  const normalized = normalizeFields(fields);
  try {
    state.sink(level, formatLine(state.format, level, scope, message, normalized));
  } catch {
    // Logging must never throw into the caller.
  }
  if (level === "error") {
    reportError(thrown ?? new Error(message), {
      scope,
      message,
      fields: normalized,
      level: "error",
    });
  }
}

export function createLogger(scope: string, bindings: LogFields = {}): Logger {
  const withBindings = (fields?: LogFields) =>
    Object.keys(bindings).length === 0 ? fields : { ...bindings, ...fields };
  return {
    debug: (message, fields) => emit("debug", scope, message, withBindings(fields)),
    info: (message, fields) => emit("info", scope, message, withBindings(fields)),
    warn: (message, fields) => emit("warn", scope, message, withBindings(fields)),
    error: (message, fields) => emit("error", scope, message, withBindings(fields)),
    child: (more) => createLogger(scope, { ...bindings, ...more }),
  };
}
