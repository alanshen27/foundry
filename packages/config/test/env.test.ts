import { afterEach, describe, expect, it, vi } from "vitest";

const production = {
  DATABASE_URL: "postgresql://u:p@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
  AUTH_MODE: "supabase",
  AUTH_SECRET: "a-long-generated-secret",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  REDIS_URL: "rediss://default:pw@example.upstash.io:6379",
  APP_ORIGIN: "https://foundry-web.onrender.com",
};

// The REDIS_URL schema is chosen at import time from process.env.RENDER.
async function load(render: boolean) {
  vi.resetModules();
  if (render) process.env.RENDER = "true";
  else delete process.env.RENDER;
  const config = await import("../src/index");
  config.resetServerEnvCacheForTests();
  return config;
}

afterEach(() => {
  delete process.env.RENDER;
});

describe("getServerEnv on Render", () => {
  it("accepts a complete production environment", async () => {
    const { getServerEnv } = await load(true);
    expect(getServerEnv({ ...production }).AUTH_MODE).toBe("supabase");
  });

  it.each([
    ["AUTH_MODE", { AUTH_MODE: "local" }],
    ["AUTH_SECRET", { AUTH_SECRET: undefined }],
    ["APP_ORIGIN", { APP_ORIGIN: undefined }],
    ["APP_ORIGIN", { APP_ORIGIN: "http://localhost:3000" }],
    ["REDIS_URL", { REDIS_URL: undefined }],
    ["DATABASE_URL", { DATABASE_URL: "postgresql://foundry:foundry@localhost:5432/foundry" }],
  ])("rejects an unsafe %s", async (key, override) => {
    const { getServerEnv } = await load(true);
    expect(() => getServerEnv({ ...production, ...override })).toThrow(new RegExp(`- ${key}:`));
  });

  it("drops a leftover localhost collaboration URL instead of failing", async () => {
    const { getServerEnv } = await load(true);
    const env = getServerEnv({ ...production, NEXT_PUBLIC_COLLAB_URL: "ws://localhost:1234" });
    expect(env.NEXT_PUBLIC_COLLAB_URL).toBeUndefined();
  });
});

describe("getServerEnv locally", () => {
  it("allows local auth, localhost services, and a default Redis", async () => {
    const { getServerEnv } = await load(false);
    const env = getServerEnv({
      DATABASE_URL: "postgresql://foundry:foundry@localhost:5432/foundry",
      AUTH_SECRET: "dev-secret",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(env.AUTH_MODE).toBe("local");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("still requires AUTH_SECRET for local auth", async () => {
    const { getServerEnv } = await load(false);
    expect(() =>
      getServerEnv({
        DATABASE_URL: "postgresql://localhost/foundry",
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      }),
    ).toThrow(/AUTH_SECRET is required when AUTH_MODE=local/);
  });
});
