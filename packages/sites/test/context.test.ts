import { describe, expect, it } from "vitest";
import { buildSiteSystemPrompt } from "../src";

describe("buildSiteSystemPrompt", () => {
  it("forbids proven claims when the product is unverified", () => {
    const prompt = buildSiteSystemPrompt({
      productName: "Palm Rover",
      verified: false,
    });

    expect(prompt).toContain("has NOT completed verification");
    expect(prompt).toContain("UNVERIFIED PRODUCT");
    expect(prompt).toContain("Release: none");
  });

  it("allows requirement claims once verified but never certification claims", () => {
    const prompt = buildSiteSystemPrompt({
      productName: "Palm Rover",
      releaseVersion: "1.0.0",
      verified: true,
    });

    expect(prompt).toContain("passed verification");
    expect(prompt).toContain("Do not claim any certification");
    expect(prompt).toContain("Do not show an unverified or fake-product warning banner");
    expect(prompt).toContain("Release: 1.0.0");
  });

  it("renders requirements and components as the only usable facts", () => {
    const prompt = buildSiteSystemPrompt({
      productName: "Palm Rover",
      summary: "A palm-sized autonomous rover",
      verified: false,
      requirements: [{ label: "Runtime", detail: "90 minutes" }, { label: "IP rating" }],
      components: [{ name: "ESP32-S3", quantity: 1 }],
    });

    expect(prompt).toContain("- Runtime: 90 minutes");
    expect(prompt).toContain("- IP rating");
    expect(prompt).toContain("- ESP32-S3 x1");
    expect(prompt).toContain("A palm-sized autonomous rover");
  });

  it("tells the builder not to generate a checkout flow", () => {
    const prompt = buildSiteSystemPrompt({ productName: "Palm Rover", verified: true });

    expect(prompt).toContain("Do not add a checkout or payment flow");
  });

  it("passes attached media through as verbatim URLs with slot roles", () => {
    const prompt = buildSiteSystemPrompt({
      productName: "Palm Rover",
      verified: true,
      media: [
        { slot: "HERO", kind: "STILL", url: "https://storage.example/hero.png", altText: "Rover" },
        {
          slot: "VIDEO_PRIMARY",
          kind: "VIDEO",
          url: "https://storage.example/clip.mp4",
          posterUrl: "https://storage.example/poster.png",
        },
      ],
    });

    expect(prompt).toContain("HERO (STILL): https://storage.example/hero.png");
    expect(prompt).toContain('alt="Rover"');
    expect(prompt).toContain("poster=https://storage.example/poster.png");
    expect(prompt).toContain("Use these URLs verbatim");
    expect(prompt).toContain("Never autoplay with sound");
  });

  it("bans invented image paths when no media is attached", () => {
    const prompt = buildSiteSystemPrompt({ productName: "Palm Rover", verified: true });

    expect(prompt).toContain("Product media: none is available");
    expect(prompt).toContain("placeholder image services");
  });
});
