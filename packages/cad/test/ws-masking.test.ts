import { describe, expect, it } from "vitest";
// Importing the client must pin masking, wherever `ws` is first pulled in.
import "../src/zookeeper";

describe("ws masking", () => {
  it("pins ws to its pure-JS masker so bundling can't break frames ≥48 bytes", () => {
    expect(process.env.WS_NO_BUFFER_UTIL).toBe("1");
  });
});
