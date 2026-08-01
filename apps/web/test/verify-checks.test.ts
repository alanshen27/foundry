import { describe, expect, it } from "vitest";
import { groupChecksByTarget } from "@/lib/verify-checks";

const check = (targetPath: string | null, status = "PENDING", waived = false) => ({
  targetPath,
  status,
  waived,
});

describe("groupChecksByTarget", () => {
  it("groups by target with project-wide last", () => {
    const groups = groupChecksByTarget([
      check(null),
      check("parts/bracket.kcl", "PASS"),
      check("assembly/product.kcl"),
      check("parts/bracket.kcl", "FAIL"),
    ]);
    expect(groups.map((g) => g.target)).toEqual([
      "assembly/product.kcl",
      "parts/bracket.kcl",
      null,
    ]);
    expect(groups[1]?.checks).toHaveLength(2);
  });

  it("counts blocking checks, ignoring waived ones", () => {
    const groups = groupChecksByTarget([
      check("main.kcl", "FAIL"),
      check("main.kcl", "FAIL", true),
      check("main.kcl", "PASS"),
      check("main.kcl", "WARNING"),
    ]);
    expect(groups[0]?.blocking).toBe(1);
  });

  it("treats blank target paths as project-wide", () => {
    const groups = groupChecksByTarget([check("  ")]);
    expect(groups[0]?.target).toBeNull();
  });
});
