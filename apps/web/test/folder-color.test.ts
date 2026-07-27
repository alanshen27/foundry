import { describe, expect, it } from "vitest";
import {
  FOLDER_COLORS,
  defaultFolderColor,
  folderColorStyle,
  isFolderColor,
  resolveFolderColor,
} from "@/lib/folder-color";

describe("resolveFolderColor", () => {
  it("uses the stored color when the folder has one", () => {
    expect(resolveFolderColor("violet", "folder-1")).toBe("violet");
  });

  it("derives a color when the folder has never been recolored", () => {
    const derived = resolveFolderColor(null, "folder-1");
    expect(FOLDER_COLORS).toContain(derived);
  });

  it("ignores a color that is no longer in the palette", () => {
    expect(resolveFolderColor("chartreuse", "folder-1")).toBe(defaultFolderColor("folder-1"));
  });
});

describe("defaultFolderColor", () => {
  it("is stable for the same folder", () => {
    expect(defaultFolderColor("folder-1")).toBe(defaultFolderColor("folder-1"));
  });

  it("spreads folders across the palette", () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => defaultFolderColor(`folder-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(3);
  });

  it("never derives slate, which reads as uncolored", () => {
    for (let i = 0; i < 60; i += 1) {
      expect(defaultFolderColor(`folder-${i}`)).not.toBe("slate");
    }
  });

  it("handles an empty seed", () => {
    expect(FOLDER_COLORS).toContain(defaultFolderColor(""));
  });
});

describe("isFolderColor", () => {
  it("accepts palette ids and rejects everything else", () => {
    expect(isFolderColor("teal")).toBe(true);
    expect(isFolderColor("burgundy")).toBe(false);
    expect(isFolderColor(null)).toBe(false);
    expect(isFolderColor(3)).toBe(false);
  });
});

describe("folderColorStyle", () => {
  it("returns classes for both stored and derived colors", () => {
    expect(folderColorStyle("red", "folder-1").icon).toContain("text-red");
    expect(folderColorStyle(null, "folder-1").icon).toMatch(/^text-/);
  });

  it("keeps slate selectable even though it is never derived", () => {
    expect(folderColorStyle("slate", "folder-1").label).toBe("Slate");
  });
});
