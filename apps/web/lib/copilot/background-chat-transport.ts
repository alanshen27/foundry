import { DefaultChatTransport, type ChatTransport, type UIMessage, type UIMessageChunk } from "ai";

export type AiPingTip = { id: string; text: string };

type Body = {
  projectId: string;
  branchId: string;
  channelId: string;
  /** Fired once the server accepts the run so the client can cancel that id only. */
  onRunId?: (runId: string) => void;
  /** Soft nudge when a note looks AI-related but had no @AI (no agent run). */
  onPingTip?: (tip: AiPingTip) => void;
};

/** Parse JSON API errors without throwing on HTML error pages. */
async function readApiError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as { error?: string };
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Copilot transport backed by the chat-run worker:
 * 1. POST enqueues a run (returns immediately)
 * 2. GET SSE on /api/ai/chat/runs/:runId/stream fans out chunks to every client
 */
export class BackgroundChatTransport<
  UI_MESSAGE extends UIMessage = UIMessage,
> extends DefaultChatTransport<UI_MESSAGE> {
  constructor(private readonly ctx: Body) {
    super();
  }

  async sendMessages(
    options: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: this.ctx.projectId,
        branchId: this.ctx.branchId,
        channelId: this.ctx.channelId,
        messages: options.messages,
      }),
      signal: options.abortSignal,
    });

    const text = await response.text();
    let payload: {
      runId?: string | null;
      error?: string;
      invoked?: boolean;
      tip?: AiPingTip;
    } = {};
    try {
      payload = text
        ? (JSON.parse(text) as {
            runId?: string | null;
            error?: string;
            invoked?: boolean;
            tip?: AiPingTip;
          })
        : {};
    } catch {
      throw new Error("Failed to start copilot run");
    }
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to start copilot run");
    }

    // Message persisted as a human note — no assistant stream.
    if (!payload.runId) {
      if (payload.tip?.id && payload.tip.text) {
        this.ctx.onPingTip?.(payload.tip);
      }
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close();
        },
      });
    }

    this.ctx.onRunId?.(payload.runId);
    return this.openRunStream(payload.runId, options.abortSignal);
  }

  async reconnectToStream(
    _options: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const url = new URL("/api/ai/chat/stream", window.location.origin);
    url.searchParams.set("projectId", this.ctx.projectId);
    url.searchParams.set("channelId", this.ctx.channelId);

    // No abortSignal on reconnect in the ChatTransport type — Stop cancels the
    // run server-side (CANCELLED), which closes this SSE on the next poll.
    const response = await fetch(url.toString(), { credentials: "same-origin" });
    if (response.status === 204) return null;
    // Reconnect is best-effort (page load / tab return). Don't surface server
    // misconfig as a chat error — that would flash on every navigation.
    if (!response.ok) {
      console.warn(
        "Copilot stream reconnect failed:",
        await readApiError(response, `HTTP ${response.status}`),
      );
      return null;
    }
    if (!response.body) return null;
    return this.processResponseStream(response.body);
  }

  private async openRunStream(
    runId: string,
    abortSignal: AbortSignal | undefined,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const response = await fetch(`/api/ai/chat/runs/${runId}/stream`, {
      credentials: "same-origin",
      signal: abortSignal,
    });
    if (!response.ok) {
      throw new Error(await readApiError(response, "Failed to open copilot stream"));
    }
    if (!response.body) throw new Error("Empty copilot stream body");
    return this.processResponseStream(response.body);
  }
}
