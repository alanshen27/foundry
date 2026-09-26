import { describe, expect, it } from "vitest";
import {
  clampChatSidebarWidth,
  keyboardChatSidebarWidth,
  maxChatSidebarWidth,
  readChatSidebarWidth,
} from "@/lib/copilot/sidebar-width";

describe("chat sidebar width", () => {
  it("uses a compact default and restores existing preferences without narrowing them", () => {
    expect(readChatSidebarWidth(null)).toBe(352);
    expect(readChatSidebarWidth("400")).toBe(400);
    expect(readChatSidebarWidth("1200")).toBe(1200);
    for (const saved of ["", "NaN", "Infinity", "400px", "299", "1201"]) {
      expect(readChatSidebarWidth(saved)).toBe(352);
    }
  });

  it("keeps most of the desktop available to the canvas", () => {
    expect(maxChatSidebarWidth(1440)).toBe(600);
    expect(clampChatSidebarWidth(1200, 1440)).toBe(600);
    expect(clampChatSidebarWidth(1200, 1024)).toBeCloseTo(450.56);
    expect(clampChatSidebarWidth(100, 1440)).toBe(300);
    expect(clampChatSidebarWidth(352, 1440)).toBe(352);
  });

  it("fits the mobile drawer inside a narrow screen", () => {
    expect(clampChatSidebarWidth(400, 375)).toBe(351);
    expect(clampChatSidebarWidth(400, 320)).toBe(296);
    expect(clampChatSidebarWidth(1200, 900)).toBe(600);
  });

  it("resizes by keyboard from the visible divider and stops at its bounds", () => {
    expect(keyboardChatSidebarWidth(352, "ArrowLeft", 1440)).toBe(372);
    expect(keyboardChatSidebarWidth(352, "ArrowRight", 1440)).toBe(332);
    expect(keyboardChatSidebarWidth(1200, "ArrowRight", 1440)).toBe(580);
    expect(keyboardChatSidebarWidth(600, "ArrowLeft", 1440)).toBe(600);
    expect(keyboardChatSidebarWidth(300, "ArrowRight", 1440)).toBe(300);
    expect(keyboardChatSidebarWidth(352, "Home", 1440)).toBe(300);
    expect(keyboardChatSidebarWidth(352, "End", 1440)).toBe(600);
    expect(keyboardChatSidebarWidth(352, "Enter", 1440)).toBeNull();
  });
});
