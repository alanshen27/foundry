import { encodePng } from "./png";
import type { GeneratedStill, MediaAspectRatio, MediaGenerationPort } from "./port";

const DIMENSIONS: Record<MediaAspectRatio, [number, number]> = {
  "1:1": [768, 768],
  "4:3": [896, 672],
  "16:9": [1024, 576],
  "9:16": [576, 1024],
};

/** Deterministic per-prompt hue so a batch reads as distinct placeholders. */
function hueFrom(seed: string, index: number): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash + index * 47) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/**
 * SIMULATED media generator for dev/e2e when no provider key is configured.
 *
 * Stills are decodable placeholder gradients with a diagonal hatch so they are
 * obviously not product photography; every asset is flagged `simulated` so
 * callers label it (AGENTS.md rule 3). Video generation refuses outright
 * rather than pretending to produce footage.
 */
export function createSimulatedMediaGenerator(): MediaGenerationPort {
  return {
    async generateStills(request) {
      const ratio = request.aspectRatio ?? "16:9";
      const [width, height] = DIMENSIONS[ratio];
      const count = Math.max(1, Math.min(request.count, 6));

      const data: GeneratedStill[] = Array.from({ length: count }, (_, index) => {
        const hue = hueFrom(request.prompt, index);
        const bytes = encodePng(width, height, (x, y) => {
          // Diagonal hatch over a vertical gradient — visually "placeholder".
          const hatch = (x + y) % 64 < 4;
          const lightness = 0.22 + (y / height) * 0.38;
          if (hatch) return hslToRgb(hue, 0.1, 0.9);
          return hslToRgb(hue, 0.45, lightness);
        });
        return {
          bytes,
          mimeType: "image/png",
          width,
          height,
          generator: "simulated",
          simulated: true,
        };
      });

      return { ok: true, data };
    },

    async generateVideo() {
      return {
        ok: false,
        error:
          "SIMULATED media mode: no product video was generated. Set MEDIA_VIDEO_MODEL and OPENAI_API_KEY (or another configured provider) to generate real footage.",
      };
    },
  };
}
