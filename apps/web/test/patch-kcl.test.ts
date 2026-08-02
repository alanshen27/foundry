import { describe, expect, it } from "vitest";
import { applyKclEdits } from "@/lib/cad/patch-kcl";

const KCL = `width = 60
height = 25
sketch001 = startSketchOn(XY)
box = extrude(sketch001, length = height)
`;

describe("applyKclEdits", () => {
  it("applies a single unique edit", () => {
    const out = applyKclEdits(KCL, [{ find: "width = 60", replace: "width = 80" }]);
    expect(out).toEqual({ ok: true, content: KCL.replace("width = 60", "width = 80") });
  });

  it("applies edits sequentially, later edits seeing earlier results", () => {
    const out = applyKclEdits(KCL, [
      { find: "height = 25", replace: "height = 40" },
      { find: "length = height", replace: "length = height * 2" },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.content).toContain("height = 40");
      expect(out.content).toContain("length = height * 2");
    }
  });

  it("rejects a find that is not present", () => {
    const out = applyKclEdits(KCL, [{ find: "depth = 10", replace: "depth = 20" }]);
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.error).toContain("not present");
  });

  it("rejects an ambiguous find", () => {
    const out = applyKclEdits(KCL, [{ find: "height", replace: "h" }]);
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.error).toContain("more than once");
  });

  it("rejects a no-op patch", () => {
    const out = applyKclEdits(KCL, [{ find: "width = 60", replace: "width = 60" }]);
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.error).toContain("no-op");
  });

  it("reports which edit failed", () => {
    const out = applyKclEdits(KCL, [
      { find: "width = 60", replace: "width = 80" },
      { find: "missing", replace: "x" },
    ]);
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.error).toContain("edit 2");
  });
});
