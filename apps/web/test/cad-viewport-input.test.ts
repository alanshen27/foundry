import { describe, expect, it } from "vitest";
import { dragInteractionFor, toStreamPoint, wheelZoomMagnitude } from "@/lib/cad/viewport-input";

const NO_MODS = { shift: false, alt: false, ctrl: false, meta: false };

describe("dragInteractionFor", () => {
  it("orbits on a plain left drag", () => {
    expect(dragInteractionFor(0, NO_MODS)).toBe("rotate");
  });

  it("pans on shift+left, middle, and right drag", () => {
    expect(dragInteractionFor(0, { ...NO_MODS, shift: true })).toBe("pan");
    expect(dragInteractionFor(1, NO_MODS)).toBe("pan");
    expect(dragInteractionFor(2, NO_MODS)).toBe("pan");
  });

  it("zooms on alt+left drag", () => {
    expect(dragInteractionFor(0, { ...NO_MODS, alt: true })).toBe("zoom");
  });

  it("leaves ctrl/cmd+left to the OS context menu", () => {
    expect(dragInteractionFor(0, { ...NO_MODS, ctrl: true })).toBeNull();
    expect(dragInteractionFor(0, { ...NO_MODS, meta: true })).toBeNull();
  });
});

describe("wheelZoomMagnitude", () => {
  it("zooms in on a negative deltaY", () => {
    expect(wheelZoomMagnitude({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(0);
  });

  it("scales with delta instead of using a fixed step", () => {
    const small = wheelZoomMagnitude({ deltaY: 4, deltaMode: 0, ctrlKey: false });
    const notch = wheelZoomMagnitude({ deltaY: 100, deltaMode: 0, ctrlKey: false });
    expect(Math.abs(small)).toBeLessThan(Math.abs(notch));
  });

  it("normalizes line and page delta modes", () => {
    const lines = wheelZoomMagnitude({ deltaY: 3, deltaMode: 1, ctrlKey: false });
    const pixels = wheelZoomMagnitude({ deltaY: 3, deltaMode: 0, ctrlKey: false });
    expect(Math.abs(lines)).toBeGreaterThan(Math.abs(pixels));
  });

  it("boosts pinch gestures, which arrive as ctrl+wheel with tiny deltas", () => {
    const pinch = wheelZoomMagnitude({ deltaY: 3, deltaMode: 0, ctrlKey: true });
    const wheel = wheelZoomMagnitude({ deltaY: 3, deltaMode: 0, ctrlKey: false });
    expect(Math.abs(pinch)).toBeGreaterThan(Math.abs(wheel));
  });

  it("clamps a flung wheel", () => {
    expect(wheelZoomMagnitude({ deltaY: -100000, deltaMode: 0, ctrlKey: false })).toBe(120);
    expect(wheelZoomMagnitude({ deltaY: 100000, deltaMode: 0, ctrlKey: false })).toBe(-120);
  });
});

describe("toStreamPoint", () => {
  const stream = { width: 1600, height: 900 };

  it("is the identity when the stream matches the panel", () => {
    expect(toStreamPoint(400, 300, stream, stream)).toEqual({ x: 400, y: 300 });
  });

  it("rescales when the stream is capped below the panel size", () => {
    const box = { width: 3200, height: 1800 };
    expect(toStreamPoint(1600, 900, box, stream)).toEqual({ x: 800, y: 450 });
  });

  it("accounts for the crop that object-fit: cover introduces", () => {
    // A 2:1 panel showing a 16:9 stream crops the top and bottom.
    const box = { width: 1600, height: 800 };
    const center = toStreamPoint(800, 400, box, stream, "cover");
    expect(center).toEqual({ x: 800, y: 450 });
    // The top edge of the panel sits below the top of the stream.
    expect(toStreamPoint(800, 0, box, stream, "cover").y).toBeGreaterThan(0);
  });

  it("accounts for the letterbox that object-fit: contain introduces", () => {
    const box = { width: 1600, height: 1000 };
    expect(toStreamPoint(800, 500, box, stream, "contain")).toEqual({ x: 800, y: 450 });
    expect(toStreamPoint(800, 0, box, stream, "contain").y).toBeLessThan(0);
  });

  it("falls back to raw offsets before the stream reports its size", () => {
    expect(toStreamPoint(120, 80, { width: 0, height: 0 }, { width: 0, height: 0 })).toEqual({
      x: 120,
      y: 80,
    });
  });

  it("maps a click to the engine's render pixel, not the panel pixel", () => {
    // A pick has to name an exact pixel in the engine framebuffer, so a panel
    // wider than the stream cap must be scaled down rather than passed through.
    const box = { width: 2400, height: 1350 };
    const click = toStreamPoint(2400, 1350, box, stream);
    expect(click).toEqual({ x: 1600, y: 900 });
    expect(click).not.toEqual({ x: 2400, y: 1350 });
  });
});
