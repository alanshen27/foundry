import { beforeEach, describe, expect, it, vi } from "vitest";

const userUpdate = vi.fn();
const membershipFindFirst = vi.fn();
const recordAudit = vi.fn();
const storagePut = vi.fn();
const storageDelete = vi.fn();

vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

vi.mock("../server/storage", () => ({
  getObjectStorage: () => ({
    put: (...args: unknown[]) => storagePut(...args),
    delete: (...args: unknown[]) => storageDelete(...args),
  }),
}));

vi.mock("@foundry/db", () => ({
  prisma: {
    user: {
      update: (...args: unknown[]) => userUpdate(...args),
    },
    workspaceMembership: {
      findFirst: (...args: unknown[]) => membershipFindFirst(...args),
    },
  },
}));

const { userRouter } = await import("../server/routers/user");

const baseUser = {
  id: "user1",
  email: "ada@foundry.local",
  name: "Ada",
  avatarUrl: null as string | null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};

beforeEach(() => {
  userUpdate.mockReset();
  membershipFindFirst.mockReset().mockResolvedValue({ workspaceId: "ws1" });
  recordAudit.mockReset().mockResolvedValue(undefined);
  storagePut.mockReset();
  storageDelete.mockReset().mockResolvedValue(undefined);
});

describe("user.updateProfile", () => {
  it("updates the caller's name and audits ProfileUpdated", async () => {
    userUpdate.mockResolvedValueOnce({ ...baseUser, name: "Ada Lovelace" });

    const caller = userRouter.createCaller({ user: baseUser });
    const result = await caller.updateProfile({ name: "Ada Lovelace" });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: { name: "Ada Lovelace" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ProfileUpdated",
        workspaceId: "ws1",
        actorId: "user1",
        payload: { fields: ["name"] },
      }),
    );
    expect(result.name).toBe("Ada Lovelace");
  });
});

describe("user.uploadAvatar", () => {
  it("stores the image and sets a Foundry avatar URL", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    storagePut.mockResolvedValueOnce({
      key: "users/user1/avatar-abc.png",
      sha256: "deadbeef",
      sizeBytes: png.length,
      contentType: "image/png",
      backend: "SUPABASE",
    });
    userUpdate.mockResolvedValueOnce({
      ...baseUser,
      avatarUrl: "/api/files/users/user1/avatar-abc.png",
    });

    const caller = userRouter.createCaller({ user: baseUser });
    const result = await caller.uploadAvatar({
      mimeType: "image/png",
      contentBase64: png.toString("base64"),
    });

    expect(storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/user1\/avatar-.+\.png$/),
      expect.any(Buffer),
      "image/png",
    );
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: { avatarUrl: "/api/files/users/user1/avatar-abc.png" },
    });
    expect(result.avatarUrl).toBe("/api/files/users/user1/avatar-abc.png");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ProfileUpdated",
        payload: expect.objectContaining({ fields: ["avatarUrl"] }),
      }),
    );
  });

  it("rejects empty payloads", async () => {
    const caller = userRouter.createCaller({ user: baseUser });
    await expect(
      caller.uploadAvatar({ mimeType: "image/png", contentBase64: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storagePut).not.toHaveBeenCalled();
  });
});

describe("user.clearAvatar", () => {
  it("clears avatarUrl and deletes a prior Foundry object", async () => {
    const withAvatar = {
      ...baseUser,
      avatarUrl: "/api/files/users/user1/avatar-old.png",
    };
    userUpdate.mockResolvedValueOnce({ ...baseUser, avatarUrl: null });

    const caller = userRouter.createCaller({ user: withAvatar });
    const result = await caller.clearAvatar();

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: { avatarUrl: null },
    });
    expect(storageDelete).toHaveBeenCalledWith("users/user1/avatar-old.png");
    expect(result.avatarUrl).toBeNull();
  });
});
