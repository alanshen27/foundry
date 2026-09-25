/**
 * SourcingPort: the only component-pricing surface app code may use.
 *
 * Modelled on `@foundry/commerce`'s port/real/simulated split — a paid,
 * rate-limited distributor API (Octopart/Nexar, DigiKey, Mouser) behind the
 * same shape as a deterministic offline stand-in, so a demo never depends on
 * a live network call and a real key drops in later with no redesign.
 */

export type LifecycleStatus = "ACTIVE" | "NRND" | "EOL" | "UNKNOWN";

export type SourcingQuote = {
  /** Stable key the caller matched this quote by — echoed back for joining. */
  partKey: string;
  unitPriceCents: number | null;
  currency: string;
  lifecycleStatus: LifecycleStatus;
  leadTimeDays: number | null;
  stockQty: number | null;
  /** Whether a substitute/alternate part is known — bears on lifecycle risk. */
  hasSubstitute: boolean;
};

export type SourcingInput = {
  id: string;
  name: string;
  /** Manufacturer part number, when known — the real-world lookup key. */
  mpn?: string | null;
  quantity: number;
};

export type SourcingResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SourcingPort {
  quote(parts: readonly SourcingInput[]): Promise<SourcingResult<SourcingQuote[]>>;
}

/**
 * The key a part is looked up and diffed by: its MPN when known, since two
 * components with the same manufacturer part number are the same part for
 * pricing purposes, falling back to the internal id when there is no MPN.
 */
export function partKeyOf(part: Pick<SourcingInput, "id" | "mpn">): string {
  return part.mpn?.trim() || part.id;
}
