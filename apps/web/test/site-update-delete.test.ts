import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWorkspaceCapability = vi.fn();
const recordAudit = vi.fn();
const siteFindUnique = vi.fn();
const siteFindMany = vi.fn();
const siteUpdate = vi.fn();
const siteDelete = vi.fn();
const projectFindUnique = vi.fn();

vi.mock("../server/access", () => ({
  requireWorkspaceCapability: (...args: unknown[]) => requireWorkspaceCapability(...args),
}));

vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

vi.mock("../server/sites", () => ({
  getSiteBuilder: () => ({}),
  isSiteBuilderConfigured: () => false,
}));

vi.mock("@foundry/db", () => ({
  prisma: {
    site: {
      findUnique: (...args: unknown[]) => siteFindUnique(...args),
      findMany: (...args: unknown[]) => siteFindMany(...args),
      update: (...args: unknown[]) => siteUpdate(...args),
      delete: (...args: unknown[]) => siteDelete(...args),
    },
    project: {
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
    },
  },
}));

const { siteRouter } = await import("../server/routers/site");

const user = {
  id: "user1",
  email: "builder@foundry.local",
  name: "Builder",
  avatarUrl: null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};

beforeEach(() => {
  requireWorkspaceCapability.mockReset().mockResolvedValue(undefined);
  recordAudit.mockReset().mockResolvedValue(undefined);
  siteFindUnique.mockReset();
  siteFindMany.mockReset().mockResolvedValue([]);
  siteUpdate.mockReset();
  siteDelete.mockReset();
  projectFindUnique.mockReset();
});

describe("site.update / site.delete", () => {
  it("renames a site and reallocates the slug", async () => {
    siteFindUnique.mockResolvedValueOnce({
      id: "site1",
      workspaceId: "ws1",
      projectId: null,
      name: "Old Name",
      slug: "old-name",
    });
    siteUpdate.mockResolvedValueOnce({
      id: "site1",
      workspaceId: "ws1",
      projectId: null,
      name: "Launch Page",
      slug: "launch-page",
    });

    const caller = siteRouter.createCaller({ user });
    const updated = await caller.update({ id: "site1", name: "Launch Page" });

    expect(siteUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Launch Page", slug: "launch-page" }),
      where: { id: "site1" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SiteUpdated", workspaceId: "ws1" }),
    );
    expect(updated.slug).toBe("launch-page");
  });

  it("deletes a site and audits SiteDeleted", async () => {
    siteFindUnique.mockResolvedValueOnce({
      id: "site1",
      workspaceId: "ws1",
      projectId: "proj1",
      name: "Launch Page",
      slug: "launch-page",
    });
    siteDelete.mockResolvedValueOnce({});

    const caller = siteRouter.createCaller({ user });
    await expect(caller.delete({ id: "site1" })).resolves.toEqual({ id: "site1" });
    expect(siteDelete).toHaveBeenCalledWith({ where: { id: "site1" } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SiteDeleted", projectId: "proj1" }),
    );
  });
});
