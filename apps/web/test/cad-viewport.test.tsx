// @vitest-environment jsdom
/**
 * The CAD viewport renders meshes locally with Three.js. jsdom has no WebGL,
 * which is exactly the condition a user with hardware acceleration disabled
 * hits: the viewport must say so and still release callers waiting on ready.
 * Scene math lives in three-viewport.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/components/theme-provider";

const { CadViewport } = await import("@/components/engineer/cad-viewport");

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

describe("CadViewport", () => {
  it("explains a missing WebGL context and still reports ready", async () => {
    const onReady = vi.fn();
    const onError = vi.fn();
    render(
      <ThemeProvider>
        <CadViewport engine="build123d" script="" onReady={onReady} onError={onError} />
      </ThemeProvider>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0]).toMatch(/could not start the 3D viewport/);
    expect(onReady).toHaveBeenCalled();
    expect(screen.getAllByText(/Enable hardware acceleration/).length).toBeGreaterThan(0);
  });
});
