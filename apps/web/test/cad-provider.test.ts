import { beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.fn();
const createPythonCadAdapter = vi.fn();
const createAstraCadAdapter = vi.fn();
vi.mock("@foundry/config", () => ({ getServerEnv: () => env() }));
vi.mock("@foundry/cad/server", () => ({
  createPythonCadAdapter: (...args: unknown[]) => createPythonCadAdapter(...args),
  createAstraCadAdapter,
}));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});
describe("native CAD provider", () => {
  it("uses Astra for Python generation without requiring or forwarding a Zoo token", async () => {
    const port = { generate: vi.fn() };
    env.mockReturnValue({
      OPENAI_API_KEY: "generation-key",
      CAD_MODEL: "gpt-6-astra",
      ZOO_API_TOKEN: "old-unused-token",
    });
    createPythonCadAdapter.mockReturnValue(port);
    const { getPythonCad } = await import("@/server/cad");
    expect(getPythonCad()).toBe(port);
    expect(getPythonCad()).toBe(port);
    expect(createPythonCadAdapter).toHaveBeenCalledTimes(1);
    expect(createPythonCadAdapter).toHaveBeenCalledWith({
      apiKey: "generation-key",
      model: "gpt-6-astra",
    });
    expect(createAstraCadAdapter).not.toHaveBeenCalled();
  });
  it("fails closed for every legacy Zoo factory caller even with a configured token", async () => {
    env.mockReturnValue({ ZOO_API_TOKEN: "old-unused-token" });
    const { getCad } = await import("@/server/cad");
    expect(getCad).toThrow("Zoo is disabled");
    expect(createAstraCadAdapter).not.toHaveBeenCalled();
    expect(env).not.toHaveBeenCalled();
  });
});
