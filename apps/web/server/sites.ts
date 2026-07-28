import "server-only";
import { getServerEnv } from "@foundry/config";
import {
  createSimulatedSiteBuilder,
  createV0SiteBuilder,
  type SiteBuilderPort,
} from "@foundry/sites";

let instance: SiteBuilderPort | undefined;

/**
 * Site builder port. Uses the v0 Platform API when V0_API_KEY is set;
 * otherwise a SIMULATED adapter so the Sites UI is usable in dev/e2e without
 * a key. Simulated revisions are flagged in the database and refuse to
 * publish, so they can never reach a public URL.
 */
export function getSiteBuilder(): SiteBuilderPort {
  if (instance) return instance;
  const apiKey = getServerEnv().V0_API_KEY?.trim();
  instance = apiKey ? createV0SiteBuilder({ apiKey }) : createSimulatedSiteBuilder();
  return instance;
}

/** True when sites are generated for real rather than SIMULATED. */
export function isSiteBuilderConfigured(): boolean {
  return Boolean(getServerEnv().V0_API_KEY?.trim());
}
