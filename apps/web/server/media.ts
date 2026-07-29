import "server-only";
import { getServerEnv } from "@foundry/config";
import {
  createOpenAiMediaGenerator,
  createSimulatedMediaGenerator,
  type MediaGenerationPort,
} from "@foundry/media";

let instance: MediaGenerationPort | undefined;

/**
 * Product-media generator. Uses the OpenAI adapter when OPENAI_API_KEY is set;
 * otherwise a SIMULATED adapter so the Launch media UI is usable in dev/e2e.
 * Simulated assets are flagged in the database and cannot be approved for
 * marketing, so they can never reach a published storefront.
 */
export function getMediaGenerator(): MediaGenerationPort {
  if (instance) return instance;
  const env = getServerEnv();
  const apiKey = env.OPENAI_API_KEY?.trim();
  instance = apiKey
    ? createOpenAiMediaGenerator({ apiKey, videoModel: env.MEDIA_VIDEO_MODEL ?? null })
    : createSimulatedMediaGenerator();
  return instance;
}

/** True when stills are generated for real rather than SIMULATED. */
export function isMediaImageConfigured(): boolean {
  return Boolean(getServerEnv().OPENAI_API_KEY?.trim());
}

/** Video needs both a key and an accessible video model. */
export function isMediaVideoConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.OPENAI_API_KEY?.trim() && env.MEDIA_VIDEO_MODEL?.trim());
}
