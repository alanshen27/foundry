import type { LifecycleStatus, SourcingInput, SourcingPort, SourcingQuote } from "./port";
import { partKeyOf } from "./port";

/**
 * FNV-1a — small, dependency-free, stable across processes and versions.
 * Not cryptographic; it only needs to spread a part key deterministically
 * across [0, 1), not resist tampering.
 */
function hash01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Unsigned 32-bit, normalised to [0, 1).
  return (h >>> 0) / 0xffffffff;
}

/** A second, independent slice of the same key, for an uncorrelated draw. */
function hash01b(key: string): number {
  return hash01(`${key}::b`);
}
function hash01c(key: string): number {
  return hash01(`${key}::c`);
}
function hash01d(key: string): number {
  return hash01(`${key}::d`);
}

/**
 * Deterministic lifecycle status for a part key, independent of the rest of
 * the seeded adapter — so `checks.ts` can re-derive the exact same status
 * from `component.id`/`mpn` without threading live quote data through the
 * pure, synchronous check pipeline (see `checkLifecycleRisk`).
 *
 * Bucketed roughly 80% active / 12% NRND / 8% EOL, matching real distributor
 * catalogs: most parts are fine, and a demo BOM should mostly look clean with
 * a few flagged, not either all-clean or a wall of warnings.
 */
export function lifecycleStatusOf(partKey: string): LifecycleStatus {
  const draw = hash01(partKey);
  if (draw < 0.08) return "EOL";
  if (draw < 0.2) return "NRND";
  return "ACTIVE";
}

/** Deterministic "is a substitute known" — independent slice of the same key. */
export function hasSubstituteOf(partKey: string): boolean {
  return hash01b(partKey) < 0.5;
}

function unitPriceCentsOf(partKey: string, name: string): number {
  // $0.05–$50, skewed toward the cheap end by the sqrt, then nudged by name
  // length so distinct-looking parts get distinct-looking prices.
  const base = 5 + Math.sqrt(hash01(partKey)) * 4995;
  const nudge = 1 + (name.length % 7) * 0.03;
  return Math.round(base * nudge);
}

function leadTimeDaysOf(partKey: string): number {
  return 3 + Math.round(hash01c(partKey) * 87);
}

function stockQtyOf(partKey: string, lifecycle: LifecycleStatus): number {
  const draw = hash01d(partKey);
  // An EOL part with thousands in stock reads as a bug, not a feature — force
  // the lifecycle-risk story to be visually coherent.
  if (lifecycle === "EOL") return Math.round(draw * 40);
  return Math.round(draw * 5000);
}

/**
 * Deterministic offline adapter: same input always produces the same quote,
 * with no network I/O, so it is safe to demo without connectivity and
 * trivial to unit test without mocking anything.
 */
export function createSeededSourcing(): SourcingPort {
  return {
    async quote(parts: readonly SourcingInput[]): Promise<{ ok: true; data: SourcingQuote[] }> {
      const data = parts.map((part): SourcingQuote => {
        const key = partKeyOf(part);
        const lifecycleStatus = lifecycleStatusOf(key);
        return {
          partKey: key,
          unitPriceCents: unitPriceCentsOf(key, part.name),
          currency: "USD",
          lifecycleStatus,
          leadTimeDays: leadTimeDaysOf(key),
          stockQty: stockQtyOf(key, lifecycleStatus),
          hasSubstitute: hasSubstituteOf(key),
        };
      });
      return { ok: true, data };
    },
  };
}
