import { describe, expect, it } from "vitest";
import { avatarColor, avatarInitials } from "@/lib/avatar-color";

/** Any lone UTF-16 surrogate renders as a replacement glyph in the avatar. */
const hasLoneSurrogate = (s: string) =>
  /[\uD800-\uDFFF]/.test(s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""));

describe("avatarInitials", () => {
  it("takes one initial per name part", () => {
    expect(avatarInitials("William Sun")).toBe("WS");
    expect(avatarInitials("Ada")).toBe("A");
    expect(avatarInitials("ada lovelace king")).toBe("AL");
  });

  it("falls back for blank names", () => {
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
  });

  it("tolerates irregular spacing", () => {
    expect(avatarInitials("  William   Sun  ")).toBe("WS");
    expect(avatarInitials("William\tSun")).toBe("WS");
  });

  it("keeps astral characters whole", () => {
    // Slicing by UTF-16 unit would emit half a surrogate pair here.
    expect(avatarInitials("🙂 Smith")).toBe("🙂S");
    expect(avatarInitials("🙂")).toBe("🙂");
    expect(avatarInitials("𝒲illiam Sun")).toBe("𝒲S");
    for (const name of ["🙂 Smith", "🙂", "𝒲illiam Sun"]) {
      expect(hasLoneSurrogate(avatarInitials(name))).toBe(false);
    }
  });
});

describe("avatarColor", () => {
  it("is stable for the same seed", () => {
    expect(avatarColor("user_1")).toBe(avatarColor("user_1"));
  });

  it("always resolves to a real palette entry", () => {
    for (const seed of ["", "   ", "a", "user_1", "🙂", "x".repeat(500)]) {
      const color = avatarColor(seed);
      expect(color.bg).toMatch(/^bg-/);
      expect(color.text).toMatch(/^text-/);
      expect(color.tile).toMatch(/^bg-/);
    }
  });

  it("treats blank seeds as one bucket rather than throwing", () => {
    expect(avatarColor("")).toBe(avatarColor("   "));
  });
});
