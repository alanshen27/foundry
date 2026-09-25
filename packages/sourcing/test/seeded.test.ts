import { describe, expect, it } from "vitest";
import { createSeededSourcing } from "../src/seeded";
import { hasSubstituteOf, lifecycleStatusOf } from "../src/seeded";
import { partKeyOf } from "../src/port";

describe("createSeededSourcing", () => {
  const adapter = createSeededSourcing();

  it("is pure and deterministic: the same input yields the same quote", async () => {
    const parts = [{ id: "cmp-1", name: "Widget", mpn: "ABC-123", quantity: 2 }];
    const a = await adapter.quote(parts);
    const b = await adapter.quote(parts);
    expect(a).toEqual(b);
  });

  it("never resolves via network I/O — the port method returns synchronously fast", async () => {
    const start = Date.now();
    await adapter.quote([{ id: "x", name: "x", quantity: 1 }]);
    expect(Date.now() - start).toBeLessThan(20);
  });

  it("keys a quote by MPN when known, falling back to id", async () => {
    const result = await adapter.quote([
      { id: "cmp-1", name: "A", mpn: "MPN-1", quantity: 1 },
      { id: "cmp-2", name: "B", quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]!.partKey).toBe("MPN-1");
    expect(result.data[1]!.partKey).toBe("cmp-2");
  });

  it("produces a plausible price/lead-time/stock range for every quote", async () => {
    const result = await adapter.quote([
      { id: "cmp-1", name: "Resistor 220R", quantity: 10 },
      { id: "cmp-2", name: "ESP32 dev board", mpn: "ESP32-WROOM-32", quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const q of result.data) {
      expect(q.unitPriceCents).toBeGreaterThanOrEqual(5);
      expect(q.unitPriceCents).toBeLessThanOrEqual(5000 * 1.2);
      expect(q.leadTimeDays).toBeGreaterThanOrEqual(3);
      expect(q.leadTimeDays).toBeLessThanOrEqual(90);
      expect(q.stockQty).toBeGreaterThanOrEqual(0);
      expect(["ACTIVE", "NRND", "EOL"]).toContain(q.lifecycleStatus);
    }
  });

  it("forces an EOL part's stock low, so the risk story stays visually coherent", async () => {
    const eolKey = Array.from({ length: 500 }, (_, i) => `part-${i}`).find(
      (k) => lifecycleStatusOf(k) === "EOL",
    );
    expect(eolKey).toBeDefined();
    const result = await adapter.quote([{ id: eolKey!, name: "x", quantity: 1 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]!.stockQty).toBeLessThan(50);
  });

  it("yields a lifecycle distribution roughly matching the 80/12/8 target across a batch", () => {
    const sample = Array.from({ length: 2000 }, (_, i) => `synthetic-part-${i}`);
    const counts = { ACTIVE: 0, NRND: 0, EOL: 0, UNKNOWN: 0 };
    for (const key of sample) counts[lifecycleStatusOf(key)]++;
    // Loose bucket-count assertions, not exact — this is a distribution
    // sanity check, not a statistical proof.
    expect(counts.ACTIVE).toBeGreaterThan(sample.length * 0.7);
    expect(counts.NRND).toBeGreaterThan(0);
    expect(counts.EOL).toBeGreaterThan(0);
    expect(counts.EOL).toBeLessThan(sample.length * 0.2);
  });

  it("partKeyOf matches the key seeded.ts derives internally", () => {
    expect(partKeyOf({ id: "cmp-1", mpn: "MPN-1" })).toBe("MPN-1");
    expect(partKeyOf({ id: "cmp-1", mpn: null })).toBe("cmp-1");
    expect(partKeyOf({ id: "cmp-1", mpn: "  " })).toBe("cmp-1");
  });

  it("hasSubstituteOf is stable across calls", () => {
    const key = "some-part-key";
    expect(hasSubstituteOf(key)).toBe(hasSubstituteOf(key));
  });
});
