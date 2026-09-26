import { describe, expect, it, vi } from "vitest";
import { CadSceneCache } from "@/lib/cad/scene-cache";

describe("per-viewport scene cache", () => {
  it("restores a viewed part without disposal and evicts the least recently viewed scene", () => {
    const dispose = vi.fn();
    const cache = new CadSceneCache<object>(dispose, 100, 2);
    const a = {},
      b = {},
      c = {};
    cache.set("part-a:source-1", a, 30);
    cache.set("part-b:source-1", b, 30);
    expect(cache.get("part-a:source-1")).toBe(a);
    cache.set("part-c:source-1", c, 30);
    expect(cache.get("part-b:source-1")).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(b);
    expect(cache.get("part-a:source-2")).toBeUndefined();
  });

  it("bounds retained geometry by memory as well as count, leaving oversized scenes with caller", () => {
    const dispose = vi.fn();
    const cache = new CadSceneCache<object>(dispose, 100, 6);
    const a = {},
      b = {},
      big = {};
    cache.set("a", a, 70);
    cache.set("b", b, 40);
    expect(cache.owns(a)).toBe(false);
    expect(cache.owns(b)).toBe(true);
    expect(cache.set("big", big, 101)).toBe(false);
    expect(cache.owns(big)).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(a);
    cache.clear();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(cache.owns(b)).toBe(false);
  });

  it("releases cached scenes exactly once when the viewport unmounts", () => {
    const dispose = vi.fn();
    const cache = new CadSceneCache<object>(dispose);
    const scene = {};
    cache.set("part", scene, 10);
    cache.set("part", scene, 10);
    expect(dispose).not.toHaveBeenCalled();
    cache.clear();
    cache.clear();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(scene);
  });
});
