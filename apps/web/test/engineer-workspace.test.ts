import { describe, expect, it, beforeEach } from "vitest";
import { cadDoc } from "@/lib/cad/engine";
import {
  assemblyCacheKey,
  clearFinalAssemblyCache,
  getCachedFinalAssembly,
} from "@/lib/cad/final-assembly-cache";
import { EMPTY_PCB } from "@/lib/pcb/doc";
import { tabFromViewParam, tabKeyFor, ASSEMBLY_TAB } from "@/lib/engineer-tabs";

describe("final-assembly-cache", () => {
  beforeEach(() => clearFinalAssemblyCache());

  it("returns the same object while mtimes are unchanged", () => {
    const cad = cadDoc("");
    const a = getCachedFinalAssembly("p1:main", "t1", null, cad, null);
    const b = getCachedFinalAssembly("p1:main", "t1", null, cad, null);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("rebuilds when the MODEL3D mtime changes", () => {
    const cad = cadDoc("");
    const a = getCachedFinalAssembly("p1:main", "t1", null, cad, null);
    const b = getCachedFinalAssembly("p1:main", "t2", null, cad, null);
    expect(a).not.toBe(b);
    expect(b?.script).toContain("FINAL ASSEMBLY");
  });

  it("rebuilds when the PCB mtime changes", () => {
    const cad = cadDoc("");
    const a = getCachedFinalAssembly("p1:main", "t1", "p1", cad, EMPTY_PCB);
    const b = getCachedFinalAssembly("p1:main", "t1", "p2", cad, EMPTY_PCB);
    expect(a).not.toBe(b);
  });

  it("builds a stable cache key", () => {
    expect(assemblyCacheKey("s", "a", "b")).toBe("v3|s|m:a|p:b");
    expect(assemblyCacheKey("s", null, undefined)).toBe("v3|s|m:none|p:none");
  });
});

describe("engineer-tabs", () => {
  it("defaults unknown views to the pinned assembly tab", () => {
    expect(tabFromViewParam(undefined)).toEqual(ASSEMBLY_TAB);
    expect(tabFromViewParam("sourcing")).toEqual(ASSEMBLY_TAB);
    expect(tabFromViewParam("design")).toEqual(ASSEMBLY_TAB);
  });

  it("opens model / pcb / schematic / repository from view params", () => {
    expect(tabFromViewParam("pcb").kind).toBe("pcb");
    expect(tabFromViewParam("schematic").kind).toBe("schematic");
    expect(tabFromViewParam("code")).toMatchObject({
      kind: "code",
      label: "Repository",
      key: "code",
    });
    expect(tabFromViewParam("model", "comp1")).toMatchObject({
      kind: "model",
      componentId: "comp1",
      key: "model:comp1",
    });
  });

  it("keys model tabs by component when focused", () => {
    expect(tabKeyFor("model")).toBe("model");
    expect(tabKeyFor("model", "abc")).toBe("model:abc");
  });
});
