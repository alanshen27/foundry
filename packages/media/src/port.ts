/**
 * MediaGenerationPort: the only product-media generation surface app code may
 * use. Implementations wrap a vendor image/video API; the SIMULATED adapter
 * produces clearly-labeled placeholders for dev/e2e.
 *
 * Callers persist the returned bytes through ObjectStoragePort and record a
 * `ProductMedia` row. Nothing here decides marketing approval — a generated
 * render is never evidence that a product works (PRD 4, principle 3).
 */

export type MediaAspectRatio = "1:1" | "4:3" | "16:9" | "9:16";

export type GeneratedStill = {
  bytes: Uint8Array;
  mimeType: string;
  width: number | null;
  height: number | null;
  /** Adapter/model identifier stored as provenance, e.g. `openai:gpt-image-2`. */
  generator: string;
  /** True for placeholder output that must be labeled SIMULATED. */
  simulated: boolean;
};

export type GeneratedVideo = {
  bytes: Uint8Array;
  mimeType: string;
  durationMs: number | null;
  /** Optional first-frame poster so the storefront can render before playback. */
  poster: { bytes: Uint8Array; mimeType: string } | null;
  generator: string;
  simulated: boolean;
};

export type MediaResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type GenerateStillsRequest = {
  prompt: string;
  /** How many distinct stills to return. Adapters may return fewer. */
  count: number;
  aspectRatio?: MediaAspectRatio;
  signal?: AbortSignal;
};

export type GenerateVideoRequest = {
  prompt: string;
  durationSec: number;
  /** First frame, when the caller seeds from an approved still. */
  seedImage?: { bytes: Uint8Array; mimeType: string };
  signal?: AbortSignal;
};

export interface MediaGenerationPort {
  generateStills(request: GenerateStillsRequest): Promise<MediaResult<GeneratedStill[]>>;
  generateVideo(request: GenerateVideoRequest): Promise<MediaResult<GeneratedVideo>>;
}
