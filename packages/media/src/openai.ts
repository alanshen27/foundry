import type {
  GeneratedStill,
  GeneratedVideo,
  MediaAspectRatio,
  MediaGenerationPort,
  MediaResult,
} from "./port";

export type OpenAiMediaOptions = {
  apiKey: string;
  /** Image model candidates, tried in order (accounts differ in access). */
  imageModels?: readonly string[];
  /** Video model. Unset disables video generation with a clear error. */
  videoModel?: string | null;
  baseUrl?: string;
  /** Max wait for an async video job before giving up. */
  videoTimeoutMs?: number;
};

const DEFAULT_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1", "dall-e-3"] as const;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Nearest supported image size per aspect ratio. */
function imageSize(ratio: MediaAspectRatio, model: string): string {
  const wide = model.startsWith("dall-e") ? "1792x1024" : "1536x1024";
  const tall = model.startsWith("dall-e") ? "1024x1792" : "1024x1536";
  switch (ratio) {
    case "1:1":
      return "1024x1024";
    case "9:16":
      return tall;
    case "4:3":
    case "16:9":
      return wide;
  }
}

function dimensions(size: string): { width: number | null; height: number | null } {
  const [w, h] = size.split("x").map((value) => Number.parseInt(value, 10));
  return {
    width: Number.isFinite(w) ? (w as number) : null,
    height: Number.isFinite(h) ? (h as number) : null,
  };
}

function errorMessage(payload: unknown, status: number, fallback: string): string {
  const body = payload as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (HTTP ${status})`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * OpenAI-backed media generator.
 *
 * Stills use the Images API with model fallback, matching the copilot's
 * existing concept-image behavior. Video requires an explicitly configured
 * `videoModel`; without one we refuse rather than silently returning a still,
 * so a storefront never shows fabricated "footage".
 */
export function createOpenAiMediaGenerator(options: OpenAiMediaOptions): MediaGenerationPort {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const imageModels = options.imageModels ?? DEFAULT_IMAGE_MODELS;
  const videoTimeoutMs = options.videoTimeoutMs ?? 5 * 60_000;

  async function requestStill(
    prompt: string,
    ratio: MediaAspectRatio,
    signal?: AbortSignal,
  ): Promise<GeneratedStill> {
    let lastError = "Image generation failed";

    for (const model of imageModels) {
      const size = imageSize(ratio, model);
      const extra: Record<string, unknown> = model.startsWith("dall-e")
        ? { response_format: "b64_json" }
        : { quality: "medium" };

      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, prompt, n: 1, size, ...extra }),
        signal,
      });

      const payload = await readJson(response);
      const b64 = (payload as { data?: { b64_json?: string }[] } | null)?.data?.[0]?.b64_json;
      if (!response.ok || !b64) {
        lastError = errorMessage(payload, response.status, "Image generation failed");
        continue;
      }

      return {
        bytes: new Uint8Array(Buffer.from(b64, "base64")),
        mimeType: "image/png",
        ...dimensions(size),
        generator: `openai:${model}`,
        simulated: false,
      };
    }

    throw new Error(lastError);
  }

  return {
    async generateStills(request): Promise<MediaResult<GeneratedStill[]>> {
      const count = Math.max(1, Math.min(request.count, 6));
      const ratio = request.aspectRatio ?? "16:9";

      const settled = await Promise.allSettled(
        Array.from({ length: count }, () => requestStill(request.prompt, ratio, request.signal)),
      );
      const data = settled
        .filter(
          (result): result is PromiseFulfilledResult<GeneratedStill> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);

      if (data.length === 0) {
        const first = settled.find((result) => result.status === "rejected");
        const reason =
          first && first.status === "rejected"
            ? first.reason instanceof Error
              ? first.reason.message
              : String(first.reason)
            : "Image generation failed";
        return { ok: false, error: reason };
      }
      return { ok: true, data };
    },

    async generateVideo(request): Promise<MediaResult<GeneratedVideo>> {
      const model = options.videoModel?.trim();
      if (!model) {
        return {
          ok: false,
          error:
            "Video generation is not configured. Set MEDIA_VIDEO_MODEL to a video model your OpenAI account can access.",
        };
      }

      try {
        const create = await fetch(`${baseUrl}/videos`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            prompt: request.prompt,
            seconds: String(request.durationSec),
          }),
          signal: request.signal,
        });
        const created = await readJson(create);
        const jobId = (created as { id?: string } | null)?.id;
        if (!create.ok || !jobId) {
          return {
            ok: false,
            error: errorMessage(created, create.status, "Video generation failed"),
          };
        }

        const deadline = Date.now() + videoTimeoutMs;
        let status = (created as { status?: string }).status ?? "queued";
        while (status !== "completed") {
          if (status === "failed" || status === "cancelled") {
            return { ok: false, error: `Video job ${status}` };
          }
          if (Date.now() > deadline) {
            return { ok: false, error: "Video generation timed out" };
          }
          await new Promise((resolve) => setTimeout(resolve, 4_000));

          const poll = await fetch(`${baseUrl}/videos/${jobId}`, {
            headers: { authorization: `Bearer ${options.apiKey}` },
            signal: request.signal,
          });
          const polled = await readJson(poll);
          if (!poll.ok) {
            return { ok: false, error: errorMessage(polled, poll.status, "Video polling failed") };
          }
          status = (polled as { status?: string } | null)?.status ?? status;
        }

        const content = await fetch(`${baseUrl}/videos/${jobId}/content`, {
          headers: { authorization: `Bearer ${options.apiKey}` },
          signal: request.signal,
        });
        if (!content.ok) {
          return {
            ok: false,
            error: errorMessage(await readJson(content), content.status, "Video download failed"),
          };
        }
        const bytes = new Uint8Array(await content.arrayBuffer());

        return {
          ok: true,
          data: {
            bytes,
            mimeType: "video/mp4",
            durationMs: request.durationSec * 1000,
            poster: request.seedImage
              ? { bytes: request.seedImage.bytes, mimeType: request.seedImage.mimeType }
              : null,
            generator: `openai:${model}`,
            simulated: false,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Video generation failed",
        };
      }
    },
  };
}
