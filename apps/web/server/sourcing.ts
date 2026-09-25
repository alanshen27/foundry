import "server-only";
import { createSeededSourcing, type SourcingPort } from "@foundry/sourcing";

/**
 * Sourcing port for the whole app. Pricing is a distributor's catalog, not a
 * merchant's store, so unlike commerce there is nothing per-workspace to key
 * it by. Only the deterministic offline adapter exists today; a real
 * distributor adapter implements the same `SourcingPort` and is picked here.
 */
export function getSourcing(): { port: SourcingPort; simulated: boolean } {
  return { port: createSeededSourcing(), simulated: true };
}
