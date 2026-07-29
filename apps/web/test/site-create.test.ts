import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWorkspaceCapability = vi.fn();
const recordAudit = vi.fn();
const siteFindMany = vi.fn();
const siteCreate = vi.fn();
const workspaceCreate = vi.fn();
const createSite = vi.fn();

vi.mock("../server/access", () => ({
  requireWorkspaceCapability: (...args: unknown[]) => requireWorkspaceCapability(...args),
}));

vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

vi.mock("../server/sites", () => ({
  getSiteBuilder: () => ({ createSite }),
  isSiteBuilderConfigured: () => false,
}));

vi.mock("@foundry/db", () => ({
  prisma: {
    site: {
      findMany: (...args: unknown[]) => siteFindMany(...args),
      create: (...args: unknown[]) => siteCreate(...args),
    },
    workspace: {
      create: (...args: unknown[]) => workspaceCreate(...args),
    },
  },
}));

const { siteRouter } = await import("../server/routers/site");

beforeEach(() => {
  requireWorkspaceCapability.mockReset().mockResolvedValue(undefined);
  recordAudit.mockReset().mockResolvedValue(undefined);
  siteFindMany.mockReset().mockResolvedValue([]);
  createSite.mockReset().mockResolvedValue({
    ok: true,
    data: {
      chatId: "chat1",
      versionId: "ver1",
      previewUrl: "https://preview.example",
      builderUrl: "https://builder.example",
      simulated: true,
    },
  });
  siteCreate.mockReset().mockResolvedValue({
    id: "site1",
    workspaceId: "ws1",
    name: "E2E Launch Site",
    slug: "e2e-launch-site",
    simulated: true,
  });
  workspaceCreate.mockReset();
});

describe("site.create", () => {
  it("creates a Site under the given workspace and never creates a Workspace", async () => {
    const caller = siteRouter.createCaller({
      user: {
        id: "user1",
        email: "builder@foundry.local",
        name: "Builder",
        avatarUrl: null,
        supabaseId: null,
        localPasswordHash: null,
        createdAt: new Date(),
      },
    });

    const site = await caller.create({
      workspaceId: "ws1",
      name: "E2E Launch Site",
      prompt: "E2E Launch Site",
    });

    expect(workspaceCreate).not.toHaveBeenCalled();
    expect(createSite).toHaveBeenCalled();
    expect(siteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws1",
        name: "E2E Launch Site",
        slug: "e2e-launch-site",
        createdById: "user1",
      }),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SiteCreated", workspaceId: "ws1" }),
    );
    expect(site.slug).toBe("e2e-launch-site");
  });
});
