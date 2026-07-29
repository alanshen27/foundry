import { describe, expect, it } from "vitest";
import { createSimulatedMediaGenerator } from "../src/simulated";
import { buildMediaPrompt } from "../src/prompt";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("simulated media generator", () => {
  it("returns decodable PNG placeholders flagged simulated", async () => {
    const generator = createSimulatedMediaGenerator();
    const result = await generator.generateStills({
      prompt: "a palm-sized air quality monitor",
      count: 3,
      aspectRatio: "16:9",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(3);
    for (const still of result.data) {
      expect([...still.bytes.slice(0, 8)]).toEqual(PNG_MAGIC);
      expect(still.mimeType).toBe("image/png");
      expect(still.simulated).toBe(true);
      expect(still.generator).toBe("simulated");
      expect(still.width).toBe(1024);
      expect(still.height).toBe(576);
    }
  });

  it("refuses video instead of faking footage", async () => {
    const generator = createSimulatedMediaGenerator();
    const result = await generator.generateVideo({ prompt: "orbit the product", durationSec: 6 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/SIMULATED/);
  });
});

describe("buildMediaPrompt", () => {
  it("grounds the prompt in product facts and bans invented marks", () => {
    const prompt = buildMediaPrompt({
      context: {
        productName: "AirNode",
        summary: "Pocket air quality monitor",
        formNotes: ["Fits in a palm", "E-ink display"],
        components: ["E-ink display", "USB-C port"],
        verified: false,
      },
      role: "HERO",
      userPrompt: "matte charcoal finish",
    });

    expect(prompt).toContain("AirNode");
    expect(prompt).toContain("E-ink display");
    expect(prompt).toContain("matte charcoal finish");
    expect(prompt).toMatch(/Hero shot/);
    expect(prompt).toMatch(/certification marks/);
    expect(prompt).toMatch(/pre-production design concept/);
  });

  it("adds motion direction for video", () => {
    const prompt = buildMediaPrompt({
      context: { productName: "AirNode", verified: true },
      role: "HERO",
      motion: true,
    });
    expect(prompt).toMatch(/orbit/i);
  });
});
