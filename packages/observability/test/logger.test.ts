import { beforeEach, describe, expect, it } from "vitest";
import {
  configureObservability,
  createLogger,
  formatLine,
  reportError,
  serializeError,
  type ErrorContext,
  type LogLevel,
} from "../src/index";

let lines: { level: LogLevel; line: string }[] = [];
let reports: { error: unknown; context: ErrorContext }[] = [];

beforeEach(() => {
  lines = [];
  reports = [];
  configureObservability({
    service: "test",
    format: "json",
    minLevel: "debug",
    sink: (level, line) => lines.push({ level, line }),
    reporter: { capture: (error, context) => reports.push({ error, context }) },
  });
});

const parsed = () => lines.map((l) => JSON.parse(l.line) as Record<string, unknown>);

describe("createLogger", () => {
  it("writes one JSON object per line with scope, level and fields", () => {
    createLogger("chat-run").info("step finished", { runId: "r1", tools: 2 });
    expect(parsed()[0]).toMatchObject({
      level: "info",
      service: "test",
      scope: "chat-run",
      message: "step finished",
      runId: "r1",
      tools: 2,
    });
  });

  it("carries child bindings on every line", () => {
    const log = createLogger("chat-run").child({ runId: "r1" });
    log.warn("slow");
    log.info("done", { steps: 4 });
    expect(parsed().map((l) => l.runId)).toEqual(["r1", "r1"]);
    expect(parsed()[1]).toMatchObject({ steps: 4 });
  });

  it("drops lines below the minimum level", () => {
    configureObservability({ minLevel: "warn" });
    const log = createLogger("x");
    log.debug("no");
    log.info("no");
    log.warn("yes");
    expect(lines.map((l) => l.level)).toEqual(["warn"]);
  });

  it("serialises errors instead of printing {}", () => {
    createLogger("x").warn("failed", { err: new Error("boom") });
    const err = parsed()[0]!.err as Record<string, unknown>;
    expect(err).toMatchObject({ name: "Error", message: "boom" });
    expect(typeof err.stack).toBe("string");
  });

  it("omits undefined fields", () => {
    createLogger("x").info("m", { a: undefined, b: 1 });
    expect(parsed()[0]).not.toHaveProperty("a");
  });
});

describe("error reporting", () => {
  it("reports error-level lines with the thrown error and context", () => {
    const boom = new Error("zoo timeout");
    createLogger("tools").child({ runId: "r9" }).error("text_to_cad failed", { err: boom });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.error).toBe(boom);
    expect(reports[0]!.context).toMatchObject({
      scope: "tools",
      message: "text_to_cad failed",
      fields: expect.objectContaining({ runId: "r9" }),
    });
  });

  it("synthesises an error when none was attached, so nothing is lost", () => {
    createLogger("x").error("invariant broken");
    expect(reports[0]!.error).toBeInstanceOf(Error);
    expect((reports[0]!.error as Error).message).toBe("invariant broken");
  });

  it("does not report warnings", () => {
    createLogger("x").warn("retrying", { err: new Error("transient") });
    expect(reports).toHaveLength(0);
  });

  it("survives a reporter that throws", () => {
    configureObservability({
      reporter: {
        capture: () => {
          throw new Error("reporter down");
        },
      },
    });
    expect(() => createLogger("x").error("m")).not.toThrow();
    expect(() => reportError(new Error("e"), { scope: "x" })).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});

describe("serializeError", () => {
  it("expands AggregateError so refused connections show their addresses", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
      code: "ECONNREFUSED",
    });
    const out = serializeError(new AggregateError([refused], ""));
    expect(out.errors?.[0]).toMatchObject({
      code: "ECONNREFUSED",
      message: expect.stringContaining("6379"),
    });
  });

  it("follows causes, but not forever", () => {
    let error: Error = new Error("root");
    for (let i = 0; i < 10; i++) error = new Error(`wrap ${i}`, { cause: error });
    let depth = 0;
    let current: unknown = serializeError(error);
    while (current && typeof current === "object" && "cause" in current) {
      current = (current as { cause: unknown }).cause;
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(3);
  });

  it("handles thrown non-errors", () => {
    expect(serializeError("plain string")).toEqual({ name: "NonError", message: "plain string" });
    expect(serializeError({ code: 1 })).toEqual({ name: "NonError", message: '{"code":1}' });
  });

  it("does not throw on circular values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeError(circular)).not.toThrow();
  });
});

describe("pretty format", () => {
  it("reads as one line with key=value fields", () => {
    const line = formatLine(
      "pretty",
      "warn",
      "redis",
      "connection lost",
      { host: "localhost:6379", attempt: 3 },
      new Date("2026-09-16T10:11:12Z"),
    );
    expect(line).toBe("10:11:12 WARN  [redis] connection lost host=localhost:6379 attempt=3");
  });
});
