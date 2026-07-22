import { describe, expect, it } from "vitest";
import { canTransitionStage } from "../src/stages";

describe("canTransitionStage", () => {
  it("allows opening a stage", () => {
    expect(canTransitionStage("NOT_STARTED", "DRAFT")).toBe(true);
  });

  it("treats a no-op transition as valid", () => {
    expect(canTransitionStage("APPROVED", "APPROVED")).toBe(true);
    expect(canTransitionStage("DRAFT", "DRAFT")).toBe(true);
  });

  it("walks the happy path draft -> review -> approved", () => {
    expect(canTransitionStage("DRAFT", "NEEDS_REVIEW")).toBe(true);
    expect(canTransitionStage("NEEDS_REVIEW", "APPROVED")).toBe(true);
  });

  it("allows re-opening and staleness", () => {
    expect(canTransitionStage("APPROVED", "STALE")).toBe(true);
    expect(canTransitionStage("APPROVED", "DRAFT")).toBe(true);
    expect(canTransitionStage("STALE", "RUNNING")).toBe(true);
    expect(canTransitionStage("BLOCKED", "DRAFT")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransitionStage("NOT_STARTED", "APPROVED")).toBe(false);
    expect(canTransitionStage("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionStage("APPROVED", "RUNNING")).toBe(false);
    expect(canTransitionStage("NOT_STARTED", "RUNNING")).toBe(false);
  });
});
