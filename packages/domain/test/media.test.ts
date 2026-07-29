import { describe, expect, it } from "vitest";
import {
  canAttachToSlot,
  generateStillsInputSchema,
  mediaExtension,
  productMediaKey,
  SITE_MEDIA_SLOT_LIMITS,
} from "../src/media";

describe("canAttachToSlot", () => {
  it("rejects a video in a still-only slot", () => {
    const result = canAttachToSlot({ slot: "HERO", kind: "VIDEO", existing: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("wrong_kind");
  });

  it("rejects a still in the video slot", () => {
    const result = canAttachToSlot({ slot: "VIDEO_PRIMARY", kind: "STILL", existing: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("wrong_kind");
  });

  it("allows one hero and refuses a second", () => {
    expect(canAttachToSlot({ slot: "HERO", kind: "STILL", existing: [] }).ok).toBe(true);
    const result = canAttachToSlot({
      slot: "HERO",
      kind: "STILL",
      existing: [{ slot: "HERO", media: { kind: "STILL" } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("slot_full");
  });

  it("counts only the target slot toward its limit", () => {
    const existing = Array.from({ length: SITE_MEDIA_SLOT_LIMITS.GALLERY }, () => ({
      slot: "GALLERY" as const,
      media: { kind: "STILL" as const },
    }));
    expect(canAttachToSlot({ slot: "GALLERY", kind: "STILL", existing }).ok).toBe(false);
    expect(canAttachToSlot({ slot: "HERO", kind: "STILL", existing }).ok).toBe(true);
  });
});

describe("storage keys", () => {
  it("scopes media under its project so the file route can serve it", () => {
    expect(productMediaKey({ projectId: "proj1", batchId: "job1", filename: "0-hero.png" })).toBe(
      "projects/proj1/media/job1/0-hero.png",
    );
  });

  it("maps mime types to readable extensions", () => {
    expect(mediaExtension("image/png")).toBe("png");
    expect(mediaExtension("video/mp4")).toBe("mp4");
    expect(mediaExtension("application/octet-stream")).toBe("bin");
  });
});

describe("generateStillsInputSchema", () => {
  it("requires a real prompt and at least one role", () => {
    expect(
      generateStillsInputSchema.safeParse({ projectId: "p", prompt: "short", roles: ["HERO"] })
        .success,
    ).toBe(false);
    expect(
      generateStillsInputSchema.safeParse({
        projectId: "p",
        prompt: "matte charcoal desktop device",
        roles: [],
      }).success,
    ).toBe(false);
  });

  it("defaults to a wide aspect ratio", () => {
    const parsed = generateStillsInputSchema.parse({
      projectId: "p",
      prompt: "matte charcoal desktop device",
      roles: ["HERO"],
    });
    expect(parsed.aspectRatio).toBe("16:9");
  });
});
