import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encode as msgpackEncode } from "@msgpack/msgpack";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { applyMessage, decodeFrames, zookeeperPrompt } from "../src/zookeeper";

/** A `Replay` document as Zoo sends it after `?replay=true`. */
function replayFrame(messages: object[]): Buffer {
  return Buffer.from(
    msgpackEncode({
      replay: { messages: messages.map((m) => new TextEncoder().encode(JSON.stringify(m))) },
    }),
  );
}

describe("decodeFrames", () => {
  it("flattens a MsgPack replay into its server messages", () => {
    const frames = decodeFrames(
      replayFrame([{ conversation_id: "c1" }, { end_of_stream: { id: "p1" } }]),
      true,
    );
    expect(frames).toEqual([{ conversation_id: "c1" }, { end_of_stream: { id: "p1" } }]);
  });

  it("reads a plain JSON frame", () => {
    expect(decodeFrames(Buffer.from('{"delta":"hi"}'), false)).toEqual([{ delta: "hi" }]);
  });
});

describe("applyMessage", () => {
  it("treats a backend shutdown as a retryable drop", () => {
    const state = { conversationId: "c1", files: null, narration: null };
    expect(applyMessage({ backend_shutdown: { reason: "rollout" } }, state)).toEqual({
      kind: "dropped",
      detail: "Zoo Zookeeper backend is restarting: rollout",
    });
  });

  it("treats a service error as final", () => {
    const state = { conversationId: "c1", files: null, narration: null };
    const outcome = applyMessage({ error: { detail: "nope" } }, state);
    expect(outcome?.kind).toBe("settled");
  });
});

describe("zookeeperPrompt resume", () => {
  let http: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((done) => (http ? http.close(() => done()) : done()));
    http = undefined;
  });

  /** Serve the copilot protocol, driving each connection with `onConnect`. */
  async function serve(
    onConnect: (socket: ServerSocket, url: URL, index: number) => void,
  ): Promise<string> {
    http = createServer();
    const wss = new WebSocketServer({ server: http });
    let index = 0;
    wss.on("connection", (socket, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      onConnect(socket, url, index++);
    });
    await new Promise<void>((ready) => http?.listen(0, "127.0.0.1", ready));
    return `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  }

  it("replays and continues a turn whose socket dropped mid-generation", async () => {
    const resumed: { url: URL; sent: unknown[] } = { url: new URL("http://x"), sent: [] };

    const baseWsUrl = await serve((socket, url, index) => {
      if (index === 0) {
        socket.send(JSON.stringify({ conversation_id: "conv-1" }));
        socket.send(JSON.stringify({ reasoning: { content: "Modelling the bracket." } }));
        // Zoo hanging up mid-turn: no close frame, no outputs yet.
        setTimeout(() => socket.terminate(), 10);
        return;
      }
      resumed.url = url;
      socket.on("message", (data) => {
        resumed.sent.push(JSON.parse(data.toString()));
        socket.send(
          replayFrame([
            { tool_output: { result: { outputs: { "main.kcl": "cube = 1\n" } } } },
            { end_of_stream: { conversation_id: "conv-1", id: "prompt-1" } },
          ]),
        );
      });
    });

    const result = await zookeeperPrompt({
      token: "t",
      prompt: "a bracket",
      currentFiles: { "main.kcl": "" },
      baseWsUrl,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        files: { "main.kcl": "cube = 1\n" },
        conversationId: "conv-1",
        promptId: "prompt-1",
      },
    });
    expect(resumed.url.searchParams.get("conversation_id")).toBe("conv-1");
    expect(resumed.url.searchParams.get("replay")).toBe("true");
    expect(resumed.sent).toEqual([{ type: "system", command: "continue" }]);
  });

  it("gives up without a conversation to rejoin, reporting the model's last words", async () => {
    const connections = vi.fn();

    const baseWsUrl = await serve((socket) => {
      connections();
      socket.send(JSON.stringify({ reasoning: { content: "Thinking about it." } }));
      setTimeout(() => socket.close(1011, "internal error"), 10);
    });

    const result = await zookeeperPrompt({
      token: "t",
      prompt: "a bracket",
      currentFiles: { "main.kcl": "" },
      baseWsUrl,
    });

    expect(connections).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error:
        'Zoo Zookeeper closed without outputs (close 1011: internal error) — last from the model: "Thinking about it."',
    });
  });
});
