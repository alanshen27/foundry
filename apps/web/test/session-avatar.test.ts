import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
const create = vi.fn();

vi.mock("@foundry/db", () => ({
  prisma: {
    user: { findUnique, update, create },
  },
}));

vi.mock("@foundry/config", () => ({
  getServerEnv: () => ({ AUTH_MODE: "supabase" }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
}));

vi.mock("../server/create-workspace", () => ({
  createWorkspaceForOwner: vi.fn(),
  defaultWorkspaceName: (name: string) => `${name}'s Workspace`,
}));

const { upsertSupabaseUser, resolveSupabaseUser } = await import("../server/session");

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  create.mockReset();
});

describe("resolveSupabaseUser", () => {
  it("returns the existing row without writing when nothing changed", async () => {
    const row = {
      id: "user1",
      email: "ada@example.com",
      avatarUrl: "https://oauth.example/pic.png",
      supabaseId: "sb1",
    };
    findUnique.mockResolvedValueOnce(row);

    const result = await resolveSupabaseUser({
      subject: "sb1",
      email: "ada@example.com",
      avatarUrl: "https://oauth.example/pic.png",
      provider: "supabase",
    });

    expect(result).toBe(row);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not overwrite a Foundry-hosted avatar with OAuth metadata", async () => {
    const row = {
      id: "user1",
      email: "ada@example.com",
      avatarUrl: "/api/files/users/user1/avatar-abc.png",
      supabaseId: "sb1",
    };
    findUnique.mockResolvedValueOnce(row);

    const result = await resolveSupabaseUser({
      subject: "sb1",
      email: "ada@example.com",
      avatarUrl: "https://oauth.example/pic.png",
      provider: "supabase",
    });

    expect(result).toBe(row);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes when email changes", async () => {
    findUnique.mockResolvedValueOnce({
      id: "user1",
      email: "old@example.com",
      avatarUrl: null,
      supabaseId: "sb1",
    });
    update.mockResolvedValueOnce({
      id: "user1",
      email: "ada@example.com",
      avatarUrl: null,
    });

    await resolveSupabaseUser({
      subject: "sb1",
      email: "ada@example.com",
      provider: "supabase",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: { email: "ada@example.com" },
    });
  });
});

describe("upsertSupabaseUser avatar sync", () => {
  it("does not write when Foundry avatar should be preserved and email matches", async () => {
    const row = {
      id: "user1",
      email: "ada@example.com",
      avatarUrl: "/api/files/users/user1/avatar-abc.png",
      supabaseId: "sb1",
    };
    findUnique.mockResolvedValueOnce(row);

    const result = await upsertSupabaseUser({
      subject: "sb1",
      email: "ada@example.com",
      avatarUrl: "https://oauth.example/pic.png",
      provider: "supabase",
    });

    expect(result).toBe(row);
    expect(update).not.toHaveBeenCalled();
  });

  it("syncs OAuth avatar when the user has no Foundry upload", async () => {
    findUnique.mockResolvedValueOnce({
      id: "user1",
      email: "ada@example.com",
      avatarUrl: "https://old.example/pic.png",
      supabaseId: "sb1",
    });
    update.mockResolvedValueOnce({
      id: "user1",
      email: "ada@example.com",
      avatarUrl: "https://oauth.example/pic.png",
    });

    await upsertSupabaseUser({
      subject: "sb1",
      email: "ada@example.com",
      avatarUrl: "https://oauth.example/pic.png",
      provider: "supabase",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: {
        avatarUrl: "https://oauth.example/pic.png",
      },
    });
  });
});
