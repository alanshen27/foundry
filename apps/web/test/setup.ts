/**
 * Shared test setup. DOM matchers and per-test unmounting only matter to
 * component tests (files marked `@vitest-environment jsdom`); in node-env
 * tests this is inert.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
