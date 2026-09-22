/**
 * Order matters as much as the limits do.
 *
 * The chat route must save the user's message before refusing (so a 429 never
 * eats their text) and refuse before creating a run (so a refused turn spends
 * nothing). Sign-in must refuse before checking the password (so a limited
 * attempt reveals nothing and costs no scrypt). These tests pin that order.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RateLimit from "../server/rate-limit";

type RateLimitModule = typeof RateLimit;

const rateLimitAll = vi.fn();
const rateLimit = vi.fn();
const checkWorkspaceBudget = vi.fn();
const saveNewMessages = vi.fn();
const createExclusiveAiRun = vi.fn();
const enqueueChatRun = vi.fn();
const verifyPassword = vi.fn();
const userFindUnique = vi.fn();
const calls: string[] = [];

vi.mock("@foundry/config", () => ({
  getServerEnv: () => ({ OPENAI_API_KEY: "sk-test", AUTH_MODE: "local", AUTH_SECRET: "s" }),
}));
vi.mock("@/server/session", () => ({
  getCurrentUser: async () => ({ id: "user1", name: "Builder", avatarUrl: null }),
  upsertSupabaseUser: vi.fn(),
}));
vi.mock("@/server/access", () => ({
  requireProjectCapability: async () => ({ project: { id: "proj1", workspaceId: "ws1" } }),
}));
vi.mock("@/server/chat", () => ({ ensureDefaultChannel: async () => ({ id: "chan1" }) }));
vi.mock("@/server/ai-edit-lock", () => ({
  createExclusiveAiRun: (...a: unknown[]) => {
    calls.push("createRun");
    return createExclusiveAiRun(...a);
  },
}));
vi.mock("@/server/chat-run/persist", () => ({
  saveNewMessages: (...a: unknown[]) => {
    calls.push("save");
    return saveNewMessages(...a);
  },
}));
vi.mock("@/server/chat-run/queue", () => ({
  enqueueChatRun: (...a: unknown[]) => enqueueChatRun(...a),
}));
vi.mock("@/lib/copilot/messages", () => ({
  validateResumableUIMessages: async (messages: unknown[]) => messages,
}));
vi.mock("@/server/rate-limit", async () => {
  const actual = await vi.importActual<RateLimitModule>("../server/rate-limit");
  return {
    ...actual,
    policies: () => ({
      aiRunBurst: { name: "ai-run-min", limit: 5, windowMs: 60_000 },
      aiRunHourly: { name: "ai-run-hour", limit: 30, windowMs: 3_600_000 },
      aiTriage: { name: "ai-triage", limit: 30, windowMs: 60_000 },
      signInEmail: { name: "signin-email", limit: 10, windowMs: 600_000 },
      signInIp: { name: "signin-ip", limit: 30, windowMs: 600_000 },
      signUpIp: { name: "signup-ip", limit: 5, windowMs: 3_600_000 },
    }),
    rateLimitAll: (...a: unknown[]) => {
      calls.push("limit");
      return rateLimitAll(...a);
    },
    rateLimit: (...a: unknown[]) => rateLimit(...a),
  };
});
vi.mock("@/server/ai-usage", () => ({
  checkWorkspaceBudget: (...a: unknown[]) => {
    calls.push("budget");
    return checkWorkspaceBudget(...a);
  },
}));
vi.mock("@foundry/db", () => ({
  prisma: {
    chatChannel: { findFirst: vi.fn() },
    chatRun: { update: vi.fn() },
    user: {
      findUnique: (...a: unknown[]) => {
        calls.push("lookupUser");
        return userFindUnique(...a);
      },
    },
  },
}));
vi.mock("@foundry/auth", () => ({
  verifyPassword: (...a: unknown[]) => {
    calls.push("verifyPassword");
    return verifyPassword(...a);
  },
  createSessionToken: () => "token",
  createSupabaseAuthAdapter: vi.fn(),
  LOCAL_SESSION_COOKIE: "foundry_session",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

const chat = await import("../app/api/ai/chat/route");
const signIn = await import("../app/api/auth/sign-in/route");

const allowed = { allowed: true, limit: 5, remaining: 4, retryAfterMs: 0, policy: null };
const refused = (policy: { name: string; windowMs: number }) => ({
  allowed: false,
  limit: 5,
  remaining: 0,
  retryAfterMs: 12_000,
  policy,
});

const aiMessage = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "@AI swap the battery for a 1200 mAh cell" }],
};
const chatRequest = () =>
  new Request("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ projectId: "proj1", branchId: "b1", messages: [aiMessage] }),
  });

beforeEach(() => {
  calls.length = 0;
  rateLimitAll.mockReset().mockResolvedValue(allowed);
  rateLimit.mockReset().mockResolvedValue(allowed);
  checkWorkspaceBudget.mockReset().mockResolvedValue({ allowed: true, usage: {} });
  saveNewMessages.mockReset().mockResolvedValue(undefined);
  createExclusiveAiRun.mockReset().mockResolvedValue({ created: true, run: { id: "run1" } });
  enqueueChatRun.mockReset().mockResolvedValue("queued");
  verifyPassword.mockReset().mockReturnValue(true);
  userFindUnique.mockReset().mockResolvedValue({ id: "u1", localPasswordHash: "h" });
});

describe("POST /api/ai/chat", () => {
  it("saves the message, then checks limits and budget, then starts the run", async () => {
    const response = await chat.POST(chatRequest());
    expect(response.status).toBe(202);
    expect(calls).toEqual(["save", "limit", "budget", "createRun"]);
  });

  it("refuses over the rate limit with 429, keeping the message and starting nothing", async () => {
    rateLimitAll.mockResolvedValue(refused({ name: "ai-run-min", windowMs: 60_000 }));
    const response = await chat.POST(chatRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    const body = await response.json();
    expect(body.persisted).toBe(true);
    expect(body.error).toContain("5 per minute");
    expect(calls).toContain("save");
    expect(calls).not.toContain("createRun");
    expect(enqueueChatRun).not.toHaveBeenCalled();
  });

  it("names the hourly window when that is the limit that refused", async () => {
    rateLimitAll.mockResolvedValue(refused({ name: "ai-run-hour", windowMs: 3_600_000 }));
    const body = await (await chat.POST(chatRequest())).json();
    expect(body.error).toContain("per hour");
  });

  it("refuses when the workspace budget is spent, without starting a run", async () => {
    checkWorkspaceBudget.mockResolvedValue({
      allowed: false,
      usage: { totalTokens: 100, budget: 100 },
      message: "budget spent",
    });
    const response = await chat.POST(chatRequest());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "budget spent", persisted: true });
    expect(calls).not.toContain("createRun");
  });

  it("checks the budget for the project's workspace", async () => {
    await chat.POST(chatRequest());
    expect(checkWorkspaceBudget).toHaveBeenCalledWith("ws1");
  });
});

describe("POST /api/auth/sign-in", () => {
  const signInRequest = () =>
    new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ email: "Builder@Foundry.local", password: "wrong" }),
    });

  it("refuses before looking the user up or verifying the password", async () => {
    rateLimitAll.mockResolvedValue(refused({ name: "signin-email", windowMs: 600_000 }));
    const response = await signIn.POST(signInRequest());
    expect(response.status).toBe(429);
    expect(calls).toEqual(["limit"]);
  });

  it("limits by address and by normalised email", async () => {
    await signIn.POST(signInRequest());
    const checks = rateLimitAll.mock.calls[0]![0] as { identifier: string }[];
    expect(checks.map((c) => c.identifier)).toEqual(["203.0.113.9", "builder@foundry.local"]);
  });

  it("goes on to check credentials when under the limit", async () => {
    verifyPassword.mockReturnValue(false);
    const response = await signIn.POST(signInRequest());
    expect(response.status).toBe(401);
    expect(calls).toEqual(["limit", "lookupUser", "verifyPassword"]);
  });
});
