import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", () => ({ request: transport.request }));
vi.mock("node:https", () => ({ request: transport.request }));
import { createPublicPageLoader } from "@/server/ai/public-page";

function respond(status: number, headers: Record<string, string>, body = "") {
  transport.request.mockImplementationOnce(
    (_url: URL, _options: unknown, callback: (response: unknown) => void) => {
      const req = Object.assign(new EventEmitter(), {
        setTimeout: vi.fn(),
        destroy: vi.fn(),
        end: () =>
          queueMicrotask(() => {
            const res = Object.assign(new EventEmitter(), { statusCode: status, headers });
            callback(res);
            res.emit("data", Buffer.from(body));
            res.emit("end");
          }),
      });
      return req;
    },
  );
}
beforeEach(() => transport.request.mockReset());
describe("public HTTP image metadata transport", () => {
  it("pins a validated address for the socket and keeps hostname for TLS", async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    respond(200, { "content-type": "text/html" }, "<html>ok</html>");
    const result = await createPublicPageLoader(new AbortController().signal, resolver).read(
      "https://example.com/a",
    );
    expect(result.body.toString()).toBe("<html>ok</html>");
    const [url, options] = transport.request.mock.calls[0]!;
    expect(url.hostname).toBe("example.com");
    const resolved = vi.fn();
    options.lookup("example.com", {}, resolved);
    expect(resolved).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(options.family).toBe(4);
    expect(resolver).toHaveBeenCalledOnce();
  });
  it("rejects a redirect to private infrastructure before opening another socket", async () => {
    respond(302, { location: "http://169.254.169.254/latest/meta-data" });
    const loader = createPublicPageLoader(new AbortController().signal, async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    await expect(loader.read("https://example.com/a")).rejects.toThrow("public HTTP");
    expect(transport.request).toHaveBeenCalledOnce();
  });
});
