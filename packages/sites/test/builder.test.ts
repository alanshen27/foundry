import { describe, expect, it } from "vitest";
import { createSimulatedSiteBuilder, createV0SiteBuilder } from "../src";

const API_KEY = "test-key";

type RecordedCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fetch stub that records what the adapter sent. */
function recordingFetch(respond: () => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function builderWith(fetchImpl: typeof fetch) {
  return createV0SiteBuilder({ apiKey: API_KEY, baseUrl: "https://api.test/v1", fetchImpl });
}

function callAt(calls: RecordedCall[], index = 0): RecordedCall {
  const call = calls[index];
  if (!call) throw new Error(`no fetch call recorded at index ${index}`);
  return call;
}

function bodyOf(call: RecordedCall): unknown {
  return JSON.parse(call.init.body as string);
}

describe("createV0SiteBuilder", () => {
  it("creates a chat and extracts the preview URL", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse({
        id: "chat_1",
        webUrl: "https://v0.dev/chat/chat_1",
        latestVersion: { id: "ver_1", demoUrl: "https://preview.test/1" },
      }),
    );

    const result = await builderWith(impl).createSite("A landing page for a rover");

    expect(result).toEqual({
      ok: true,
      data: {
        chatId: "chat_1",
        versionId: "ver_1",
        previewUrl: "https://preview.test/1",
        builderUrl: "https://v0.dev/chat/chat_1",
        simulated: false,
      },
    });
    expect(callAt(calls).url).toBe("https://api.test/v1/chats");
    expect(callAt(calls).init.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    expect(bodyOf(callAt(calls))).toEqual({ message: "A landing page for a rover" });
  });

  it("sends the product context as the system prompt", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse({ id: "chat_1", latestVersion: { id: "ver_1" } }),
    );

    await builderWith(impl).createSite("Landing page", { system: "Product: Rover" });

    expect(bodyOf(callAt(calls))).toEqual({ message: "Landing page", system: "Product: Rover" });
  });

  it("falls back to the legacy demo key for the preview URL", async () => {
    const { impl } = recordingFetch(() =>
      jsonResponse({ id: "chat_1", demo: "https://preview.test/legacy" }),
    );

    const result = await builderWith(impl).createSite("Landing page");

    expect(result.ok && result.data.previewUrl).toBe("https://preview.test/legacy");
  });

  it("reports a missing chat id rather than inventing one", async () => {
    const { impl } = recordingFetch(() => jsonResponse({ latestVersion: { id: "ver_1" } }));

    const result = await builderWith(impl).createSite("Landing page");

    expect(result).toEqual({ ok: false, error: "Site builder did not return a chat id" });
  });

  it("keeps the caller's chat id when revising", async () => {
    // v0 returns the *message* id here, which must not be mistaken for the chat.
    const { impl, calls } = recordingFetch(() =>
      jsonResponse({
        id: "msg_9",
        latestVersion: { id: "ver_2", demoUrl: "https://preview.test/2" },
      }),
    );

    const result = await builderWith(impl).reviseSite("chat_1", "Add a spec table");

    expect(result.ok && result.data.chatId).toBe("chat_1");
    expect(result.ok && result.data.versionId).toBe("ver_2");
    expect(callAt(calls).url).toBe("https://api.test/v1/chats/chat_1/messages");
  });

  it("publishes a version and returns the public URL", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse({ id: "dpl_1", webUrl: "https://rover.vercel.app", inspectorUrl: "https://i" }),
    );

    const result = await builderWith(impl).publishSite("chat_1", "ver_1");

    expect(result).toEqual({
      ok: true,
      data: { id: "dpl_1", url: "https://rover.vercel.app", inspectorUrl: "https://i" },
    });
    expect(bodyOf(callAt(calls))).toEqual({ chatId: "chat_1", versionId: "ver_1" });
  });

  it("fails when a deployment comes back without a URL", async () => {
    const { impl } = recordingFetch(() => jsonResponse({ id: "dpl_1" }));

    const result = await builderWith(impl).publishSite("chat_1", "ver_1");

    expect(result).toEqual({ ok: false, error: "Site builder did not return a deployment URL" });
  });

  it("surfaces the builder's own error body", async () => {
    const { impl } = recordingFetch(() => jsonResponse({ error: "quota exceeded" }, 429));

    const result = await builderWith(impl).createSite("Landing page");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("429");
    expect(!result.ok && result.error).toContain("quota exceeded");
  });

  it("returns an error instead of throwing when the network fails", async () => {
    const { impl } = recordingFetch(() => {
      throw new Error("ECONNREFUSED");
    });

    const result = await builderWith(impl).createSite("Landing page");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("Could not reach the site builder");
  });

  it("returns an error when the response is not JSON", async () => {
    const { impl } = recordingFetch(() => new Response("<html>502</html>", { status: 200 }));

    const result = await builderWith(impl).createSite("Landing page");

    expect(result).toEqual({ ok: false, error: "Site builder returned a malformed response" });
  });

  it("encodes the chat id into the revise path", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse({ latestVersion: { id: "v" } }));

    await builderWith(impl).reviseSite("chat/../evil", "prompt");

    expect(callAt(calls).url).toBe("https://api.test/v1/chats/chat%2F..%2Fevil/messages");
  });
});

describe("createSimulatedSiteBuilder", () => {
  it("flags every revision as simulated with no preview", async () => {
    const result = await createSimulatedSiteBuilder().createSite("Landing page");

    expect(result.ok && result.data.simulated).toBe(true);
    expect(result.ok && result.data.previewUrl).toBeNull();
  });

  it("never publishes", async () => {
    const builder = createSimulatedSiteBuilder();
    const created = await builder.createSite("Landing page");
    if (!created.ok) throw new Error("expected a simulated revision");

    const result = await builder.publishSite(created.data.chatId, created.data.versionId ?? "v1");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("SIMULATED");
  });
});
