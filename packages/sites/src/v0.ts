import { z } from "zod";
import type {
  SiteBuilderPort,
  SiteDeployment,
  SiteGenOptions,
  SiteResult,
  SiteRevision,
} from "./port";

const DEFAULT_BASE_URL = "https://api.v0.dev/v1";

/**
 * v0 responses are parsed leniently. The Platform API is in beta and adds
 * fields between releases, so we validate only what we actually depend on
 * and pass the rest through rather than failing a user's build on a new key.
 */
const versionSchema = z
  .object({
    id: z.string().optional(),
    demoUrl: z.string().optional(),
    demo: z.string().optional(),
  })
  .passthrough();

const chatSchema = z
  .object({
    id: z.string().optional(),
    chatId: z.string().optional(),
    webUrl: z.string().optional(),
    url: z.string().optional(),
    demo: z.string().optional(),
    latestVersion: versionSchema.optional(),
  })
  .passthrough();

const deploymentSchema = z
  .object({
    id: z.string(),
    webUrl: z.string().optional(),
    url: z.string().optional(),
    inspectorUrl: z.string().optional(),
  })
  .passthrough();

type ChatResponse = z.infer<typeof chatSchema>;

/** v0 has moved the preview URL between keys across beta releases. */
function previewUrlOf(chat: ChatResponse): string | null {
  return chat.latestVersion?.demoUrl ?? chat.latestVersion?.demo ?? chat.demo ?? null;
}

export type V0SiteBuilderOptions = {
  apiKey: string;
  /** Override for tests. */
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * Site builder backed by the v0 Platform API.
 *
 * v0 owns code generation, the sandboxed preview, and the Vercel deployment,
 * so this adapter is a thin, replaceable HTTP shim: no build orchestration,
 * no container lifecycle, no artifact storage on our side.
 */
export function createV0SiteBuilder(options: V0SiteBuilderOptions): SiteBuilderPort {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  async function request<T>(
    path: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<SiteResult<T>> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) return { ok: false, error: "Cancelled" };
      return { ok: false, error: `Could not reach the site builder: ${String(error)}` };
    }

    if (!response.ok) {
      // Surface v0's own message when it sends one; it explains quota and
      // validation failures far better than a bare status code.
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Site builder returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`,
      };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: "Site builder returned a malformed response" };
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: `Unexpected site builder response: ${parsed.error.message}` };
    }
    return { ok: true, data: parsed.data };
  }

  function toRevision(chatId: string, chat: ChatResponse): SiteRevision {
    return {
      chatId,
      versionId: chat.latestVersion?.id ?? null,
      previewUrl: previewUrlOf(chat),
      builderUrl: chat.webUrl ?? chat.url ?? null,
      simulated: false,
    };
  }

  return {
    async createSite(prompt, opts?: SiteGenOptions) {
      const result = await request(
        "/chats",
        opts?.system ? { message: prompt, system: opts.system } : { message: prompt },
        chatSchema,
        opts?.signal,
      );
      if (!result.ok) return result;

      const chatId = result.data.id ?? result.data.chatId;
      if (!chatId) {
        return { ok: false, error: "Site builder did not return a chat id" };
      }
      return { ok: true, data: toRevision(chatId, result.data) };
    },

    async reviseSite(chatId, prompt, opts?: SiteGenOptions) {
      const result = await request(
        `/chats/${encodeURIComponent(chatId)}/messages`,
        { message: prompt },
        chatSchema,
        opts?.signal,
      );
      if (!result.ok) return result;
      // The response id here is the message, not the conversation, so the
      // caller-supplied chatId stays authoritative.
      return { ok: true, data: toRevision(chatId, result.data) };
    },

    async publishSite(chatId, versionId, opts?: SiteGenOptions) {
      const result = await request(
        "/deployments",
        { chatId, versionId },
        deploymentSchema,
        opts?.signal,
      );
      if (!result.ok) return result;

      const url = result.data.webUrl ?? result.data.url;
      if (!url) {
        return { ok: false, error: "Site builder did not return a deployment URL" };
      }
      const deployment: SiteDeployment = {
        id: result.data.id,
        url,
        inspectorUrl: result.data.inspectorUrl ?? null,
      };
      return { ok: true, data: deployment };
    },
  };
}
