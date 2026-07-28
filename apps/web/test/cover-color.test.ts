import { describe, expect, it } from "vitest";
import { coverColor } from "@/lib/cover-color";

describe("coverColor", () => {
  it("is stable for the same title", () => {
    expect(coverColor("clock")).toEqual(coverColor("clock"));
  });

  it("changes with the title", () => {
    expect(coverColor("clock")).not.toEqual(coverColor("sensor"));
  });

  it("returns hex fills", () => {
    const c = coverColor("foundry");
    expect(c.bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(c.dot).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
