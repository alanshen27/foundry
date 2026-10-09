import { describe, expect, it, vi } from "vitest";
import {
  createSupabaseBroadcastPublisher,
  projectBroadcastChannel,
  readProjectChanges,
} from "../src";

describe("project change broadcasts", () => {
  it("scopes channels per branch and accepts only well-formed changes", () => {
    expect(projectBroadcastChannel("p1", "b1")).toBe("foundry:project:p1:b1");
    expect(
      readProjectChanges({
        changes: [
          { kind: "design", design: "PCB" },
          { kind: "code" },
          { kind: "design" },
          { kind: "secret", data: "x" },
          null,
        ],
      }),
    ).toEqual([{ kind: "design", design: "PCB" }, { kind: "code" }]);
    expect(readProjectChanges(null)).toEqual([]);
  });

  it("publishes through the REST broadcast endpoint in one request", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const publisher = createSupabaseBroadcastPublisher(
      { url: "https://example.supabase.co/", serviceRoleKey: "service" },
      fetchImpl as unknown as typeof fetch,
    );
    await publisher.publish("foundry:project:p:b", {
      event: "project-changed",
      payload: { changes: [{ kind: "code" }] },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    expect(init.headers).toMatchObject({ apikey: "service", Authorization: "Bearer service" });
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [
        {
          topic: "foundry:project:p:b",
          event: "project-changed",
          payload: { changes: [{ kind: "code" }] },
        },
      ],
    });
  });
});
