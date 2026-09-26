import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cadMeshPathSchema,
  cadMeshRequestSchema,
  cadMeshStorageKey,
  type CadMeshRequest,
} from "@/lib/cad/mesh-request";
const runPythonCad = vi.fn();
const getCurrentUser = vi.fn();
const requireProjectCapability = vi.fn();
const verifyRenderToken = vi.fn();
const storageGet = vi.fn();
vi.mock("@foundry/cad/server", () => ({
  runPythonCad: (...args: unknown[]) => runPythonCad(...args),
}));
vi.mock("@/server/storage", () => ({ getObjectStorage: () => ({ get: storageGet }) }));
vi.mock("@/server/session", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => requireProjectCapability(...args),
}));
vi.mock("@/server/render-token", () => ({
  verifyRenderToken: (...args: unknown[]) => verifyRenderToken(...args),
}));
const MODEL = {
  stl: Buffer.from("STL geometry"),
  step: Buffer.from("ISO-10303-21; exact STEP solid"),
  bbox: { center: { x: 0, y: 0, z: 5 }, dimensions: { x: 20, y: 30, z: 10 } },
  valid: true,
  solidCount: 1,
  volumeMm3: 6000,
  logs: "",
};
const OK = { ok: true as const, data: MODEL };
const SOURCE = "from build123d import *\nresult=Box(20,30,10)";
const INPUT: CadMeshRequest = {
  projectId: "p1",
  engine: "build123d",
  script: SOURCE,
  entryPath: "parts/housing/main.py",
  projectFiles: { "parts/housing/main.py": SOURCE },
};
const ASSET = {
  path: "imports/bracket.step",
  fileUrl: "/api/files/projects/p1/cad/bracket.step",
  format: "step",
  lengthUnit: "mm" as const,
};
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  runPythonCad.mockResolvedValue(OK);
  getCurrentUser.mockResolvedValue({ id: "u1" });
  requireProjectCapability.mockResolvedValue({ project: { id: "p1" } });
  verifyRenderToken.mockReturnValue(null);
  storageGet.mockResolvedValue({ body: new Uint8Array([1, 2, 3]) });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const request = (
  input: unknown = INPUT,
  signal?: AbortSignal,
  url = "http://localhost/api/cad/mesh",
) => new Request(url, { method: "POST", body: JSON.stringify(input), signal });
async function post(input: unknown = INPUT, signal?: AbortSignal) {
  return (await import("@/app/api/cad/mesh/route")).POST(request(input, signal));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("native CAD request boundaries", () => {
  it.each([
    "../secret.py",
    "/tmp/secret.py",
    "parts/../secret.py",
    "parts//main.py",
    "./main.py",
    "parts/.env",
    "parts\\main.py",
    "C:/secret.py",
    "parts/%2e%2e/secret.py",
    "parts/main.py?raw=1",
    "parts/main.py#secret",
    "parts/\u0000main.py",
  ])("rejects escaping file path %s", (path) => {
    expect(cadMeshPathSchema.safeParse(path).success).toBe(false);
    expect(cadMeshRequestSchema.safeParse({ ...INPUT, entryPath: path }).success).toBe(false);
  });
  it("accepts native module projects and rejects mixed executable formats", () => {
    expect(
      cadMeshRequestSchema.safeParse({
        ...INPUT,
        projectFiles: { "parts/housing/main.py": INPUT.script },
        meshAssets: [ASSET],
      }).success,
    ).toBe(true);
    expect(
      cadMeshRequestSchema.safeParse({ ...INPUT, projectFiles: { "parts/main.kcl": "part = 1" } })
        .success,
    ).toBe(false);
  });
  it("rejects duplicate assets and bounded source overflows", () => {
    expect(cadMeshRequestSchema.safeParse({ ...INPUT, meshAssets: [ASSET, ASSET] }).success).toBe(
      false,
    );
    expect(
      cadMeshRequestSchema.safeParse({
        ...INPUT,
        projectFiles: Object.fromEntries(
          Array.from({ length: 129 }, (_, i) => [`parts/p${i}.py`, "result=1"]),
        ),
      }).success,
    ).toBe(false);
    expect(
      cadMeshRequestSchema.safeParse({
        ...INPUT,
        script: "a".repeat(1_000_000),
        projectFiles: { "a.py": "a".repeat(1_000_001) },
      }).success,
    ).toBe(false);
  });
  it.each([
    "/api/files/projects/p2/cad/bracket.step",
    "/api/files/projects/p10/cad/bracket.step",
    "/api/files/projects/p1/../p2/a.step",
    "/api/files/projects/p1/%2e%2e/a.step",
    "https://example.com/api/files/projects/p1/a.step",
    "file:///tmp/a.step",
  ])("rejects foreign assets %s", (url) => expect(cadMeshStorageKey(url, "p1")).toBeNull());
});

describe("authorized local geometry and exact exports", () => {
  it("authorizes before execution and returns private STL in mm/Z-up", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(MODEL.stl);
    expect(response.headers.get("content-type")).toBe("model/stl");
    expect(response.headers.get("x-cad-unit")).toBe("mm");
    expect(response.headers.get("x-cad-up-axis")).toBe("z");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requireProjectCapability).toHaveBeenCalledWith("u1", "p1", "project.read");
    expect(requireProjectCapability.mock.invocationCallOrder[0]).toBeLessThan(
      runPythonCad.mock.invocationCallOrder[0]!,
    );
  });
  it("never executes legacy KCL or re-enables Zoo", async () => {
    vi.stubEnv("ZOO_API_TOKEN", "old-token");
    const response = await post({ projectId: "p1", script: "width=60" });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Zoo is disabled");
    expect(runPythonCad).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and unauthorized reads before geometry", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(401);
    requireProjectCapability.mockRejectedValueOnce(new Error("denied"));
    expect((await post()).status).toBe(403);
    expect(runPythonCad).not.toHaveBeenCalled();
  });
  it("rechecks permissions even for cached shapes", async () => {
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(runPythonCad).toHaveBeenCalledTimes(1);
    requireProjectCapability.mockRejectedValueOnce(new Error("revoked"));
    expect((await post()).status).toBe(403);
    expect(runPythonCad).toHaveBeenCalledTimes(1);
  });
  it("scopes render-token previews and assets to the token project", async () => {
    verifyRenderToken.mockReturnValue({ projectId: "p1", branchId: "b1", kind: "model3d" });
    getCurrentUser.mockResolvedValue(null);
    expect(
      (await post({ ...INPUT, projectId: undefined, renderToken: "signed", meshAssets: [ASSET] }))
        .status,
    ).toBe(200);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(storageGet).toHaveBeenCalledWith("projects/p1/cad/bracket.step");
    verifyRenderToken.mockReturnValue(null);
    expect((await post({ ...INPUT, renderToken: "expired" })).status).toBe(401);
  });
  it.each([null, { projectId: "p2", kind: "model3d" }, { projectId: "p1", kind: "circuit" }])(
    "rejects invalid render claims %j",
    async (claims) => {
      verifyRenderToken.mockReturnValue(claims);
      expect((await post({ ...INPUT, renderToken: "invalid" })).status).toBe(401);
      expect(runPythonCad).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-project assets before reading storage", async () => {
    expect(
      (
        await post({
          ...INPUT,
          meshAssets: [{ ...ASSET, fileUrl: "/api/files/projects/p2/a.step" }],
        })
      ).status,
    ).toBe(403);
    expect(storageGet).not.toHaveBeenCalled();
    expect(runPythonCad).not.toHaveBeenCalled();
  });
  it("allows development-only projectless geometry without private assets", async () => {
    expect((await post({ ...INPUT, projectId: undefined })).status).toBe(401);
    vi.stubEnv("NODE_ENV", "development");
    expect((await post({ ...INPUT, projectId: undefined })).status).toBe(200);
    expect((await post({ ...INPUT, projectId: undefined, meshAssets: [ASSET] })).status).toBe(403);
  });
  it("bounds streamed request bodies before authorization or execution", async () => {
    const { POST } = await import("@/app/api/cad/mesh/route");
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        chunks++;
        c.enqueue(new Uint8Array(1_000_001));
      },
      cancel,
    });
    expect(
      (
        await POST(
          new Request("http://localhost/api/cad/mesh", {
            method: "POST",
            body,
            duplex: "half",
          } as RequestInit),
        )
      ).status,
    ).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(chunks).toBeLessThanOrEqual(4);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON and hides kernel internals on failure", async () => {
    const { POST } = await import("@/app/api/cad/mesh/route");
    expect(
      (
        await POST(
          new Request("http://localhost/api/cad/mesh", { method: "POST", body: "bad json" }),
        )
      ).status,
    ).toBe(400);
    runPythonCad.mockResolvedValueOnce({ ok: false, error: "secret host path" });
    const response = await post();
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("secret host");
  });
  it("exports exact STEP from the same compiled snapshot and enforces export authorization", async () => {
    await post();
    const { POST } = await import("@/app/api/cad/export/route");
    const response = await POST(
      request(INPUT, undefined, "http://localhost/api/cad/export?format=step"),
    );
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(MODEL.step);
    expect(response.headers.get("content-disposition")).toContain(".step");
    expect(runPythonCad).toHaveBeenCalledTimes(1);
    getCurrentUser.mockResolvedValue(null);
    expect(
      (await POST(request(INPUT, undefined, "http://localhost/api/cad/export?format=step"))).status,
    ).toBe(401);
    expect(
      (await POST(request(INPUT, undefined, "http://localhost/api/cad/export?format=bad"))).status,
    ).toBe(400);
  });
});

describe("source snapshots, cache and cancellation", () => {
  it("passes the current unsaved entry and scoped asset bytes without mutating saved files", async () => {
    const { compileCadModel } = await import("@/server/cad-mesh");
    const input = {
      ...INPUT,
      projectFiles: {
        [INPUT.entryPath!]: "saved old source",
        "parts/base/main.py": "result=Box(1,2,3)",
      },
      meshAssets: [ASSET],
    };
    const before = structuredClone(input);
    await compileCadModel(input, "p1", new AbortController().signal);
    expect(runPythonCad).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPath: INPUT.entryPath,
        files: { ...input.projectFiles, [INPUT.entryPath!]: INPUT.script },
        assets: { [ASSET.path]: new Uint8Array([1, 2, 3]) },
      }),
    );
    expect(input).toEqual(before);
  });
  it("shares an in-flight build but one viewer cannot cancel the other", async () => {
    const { exportCadMesh } = await import("@/server/cad-mesh");
    const done = deferred<typeof OK>();
    runPythonCad.mockReturnValueOnce(done.promise);
    const a = new AbortController(),
      b = new AbortController();
    const first = exportCadMesh(INPUT, "p1", a.signal);
    const second = exportCadMesh(INPUT, "p1", b.signal);
    await vi.waitFor(() => expect(runPythonCad).toHaveBeenCalledTimes(1));
    const rejected = expect(first).rejects.toThrow("view closed");
    a.abort(new Error("view closed"));
    await rejected;
    expect(runPythonCad.mock.calls[0]![0].signal.aborted).toBe(false);
    done.resolve(OK);
    expect(await second).toEqual(MODEL.stl);
  });
  it("abandons the kernel job when every viewer cancels and allows immediate retry", async () => {
    const { exportCadMesh } = await import("@/server/cad-mesh");
    const done = deferred<typeof OK>();
    runPythonCad.mockReturnValueOnce(done.promise);
    const a = new AbortController();
    const first = exportCadMesh(INPUT, "p1", a.signal);
    await vi.waitFor(() => expect(runPythonCad).toHaveBeenCalledTimes(1));
    const rejected = expect(first).rejects.toThrow("closed");
    a.abort(new Error("closed"));
    await rejected;
    expect(runPythonCad.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(await exportCadMesh(INPUT, "p1", new AbortController().signal)).toEqual(MODEL.stl);
    done.resolve(OK);
    expect(runPythonCad).toHaveBeenCalledTimes(2);
  });
  it("does not cache failed or cancelled builds", async () => {
    const { exportCadMesh } = await import("@/server/cad-mesh");
    runPythonCad.mockResolvedValueOnce({ ok: false, error: "invalid solid" });
    await expect(exportCadMesh(INPUT, "p1", new AbortController().signal)).rejects.toThrow(
      "invalid solid",
    );
    await exportCadMesh(INPUT, "p1", new AbortController().signal);
    const aborted = new AbortController();
    aborted.abort(new Error("cancelled"));
    await expect(exportCadMesh(INPUT, "p1", aborted.signal)).rejects.toThrow("cancelled");
    expect(runPythonCad).toHaveBeenCalledTimes(2);
  });
  it("separates projects and source versions and canonicalizes file order", async () => {
    const { exportCadMesh } = await import("@/server/cad-mesh");
    const signal = new AbortController().signal;
    const files = { "a.py": "a=1", "b.py": "b=2" };
    await exportCadMesh({ ...INPUT, projectFiles: files }, "p1", signal);
    await exportCadMesh({ ...INPUT, projectFiles: { "b.py": "b=2", "a.py": "a=1" } }, "p1", signal);
    await exportCadMesh({ ...INPUT, projectFiles: files }, "p2", signal);
    await exportCadMesh(
      { ...INPUT, projectFiles: files, script: INPUT.script + "\n# edit" },
      "p1",
      signal,
    );
    expect(runPythonCad).toHaveBeenCalledTimes(3);
  });
  it("rejects foreign, missing and oversized assets before kernel execution", async () => {
    const { exportCadMesh } = await import("@/server/cad-mesh");
    const input = { ...INPUT, meshAssets: [ASSET] },
      signal = new AbortController().signal;
    await expect(exportCadMesh(input, "p2", signal)).rejects.toThrow("does not belong");
    expect(storageGet).not.toHaveBeenCalled();
    storageGet.mockResolvedValueOnce(null);
    await expect(exportCadMesh(input, "p1", signal)).rejects.toThrow("unavailable");
    storageGet.mockResolvedValueOnce({ body: { byteLength: 50_000_001 } });
    await expect(exportCadMesh(input, "p1", signal)).rejects.toThrow("exceed");
    expect(runPythonCad).not.toHaveBeenCalled();
  });
});
