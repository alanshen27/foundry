import { beforeEach, describe, expect, it, vi } from "vitest";

const requireProjectCapability = vi.fn();
const requireWorkspaceCapability = vi.fn();
const recordAudit = vi.fn();
const loadProductContext = vi.fn();
const enqueueMediaJob = vi.fn();
const storageDelete = vi.fn();

const mediaCreate = vi.fn();
const mediaFindUnique = vi.fn();
const mediaUpdate = vi.fn();
const mediaDelete = vi.fn();
const jobCreate = vi.fn();
const jobUpdate = vi.fn();
const siteFindUnique = vi.fn();
const attachmentFindMany = vi.fn();
const attachmentCreate = vi.fn();

vi.mock("../server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => requireProjectCapability(...args),
  requireWorkspaceCapability: (...args: unknown[]) => requireWorkspaceCapability(...args),
}));

vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

vi.mock("../server/product-context", async () => {
  const actual = await import("../server/product-context");
  return {
    loadProductContext: (...args: unknown[]) => loadProductContext(...args),
    toMediaPromptContext: actual.toMediaPromptContext,
  };
});

vi.mock("../server/media", () => ({
  isMediaImageConfigured: () => true,
  isMediaVideoConfigured: () => false,
}));

vi.mock("../server/media-jobs/queue", () => ({
  enqueueMediaJob: (...args: unknown[]) => enqueueMediaJob(...args),
}));

vi.mock("../server/storage", () => ({
  getObjectStorage: () => ({
    put: vi.fn(),
    delete: (...args: unknown[]) => storageDelete(...args),
    get: vi.fn(),
    head: vi.fn(),
    getSignedUrl: vi.fn(),
  }),
}));

vi.mock("@foundry/db", () => ({
  prisma: {
    productMedia: {
      create: (...args: unknown[]) => mediaCreate(...args),
      findUnique: (...args: unknown[]) => mediaFindUnique(...args),
      findMany: vi.fn(),
      update: (...args: unknown[]) => mediaUpdate(...args),
      delete: (...args: unknown[]) => mediaDelete(...args),
    },
    mediaJob: {
      create: (...args: unknown[]) => jobCreate(...args),
      update: (...args: unknown[]) => jobUpdate(...args),
      findMany: vi.fn(),
    },
    site: { findUnique: (...args: unknown[]) => siteFindUnique(...args) },
    siteMediaAttachment: {
      findMany: (...args: unknown[]) => attachmentFindMany(...args),
      create: (...args: unknown[]) => attachmentCreate(...args),
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { mediaRouter } = await import("../server/routers/media");

const user = {
  id: "user1",
  email: "builder@foundry.local",
  name: "Builder",
  avatarUrl: null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};

const project = { id: "proj1", workspaceId: "ws1" };

beforeEach(() => {
  requireProjectCapability.mockReset().mockResolvedValue({ project });
  requireWorkspaceCapability.mockReset().mockResolvedValue(undefined);
  recordAudit.mockReset().mockResolvedValue(undefined);
  loadProductContext.mockReset().mockResolvedValue({
    context: {
      productName: "Palm Rover",
      summary: "A palm-sized rover",
      verified: false,
      requirements: [{ label: "Runtime", detail: "90 minutes" }],
      components: [{ name: "ESP32-S3", quantity: 1 }],
    },
    releaseId: "rel1",
  });
  enqueueMediaJob.mockReset().mockResolvedValue("queued");
  storageDelete.mockReset().mockResolvedValue(undefined);
  mediaCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "media1",
    posterStorageKey: null,
    ...data,
  }));
  mediaFindUnique.mockReset();
  mediaUpdate.mockReset();
  mediaDelete.mockReset().mockResolvedValue({});
  jobCreate
    .mockReset()
    .mockResolvedValue({ id: "job1", type: "GENERATE_STILLS", status: "PENDING" });
  jobUpdate.mockReset().mockResolvedValue({});
  siteFindUnique.mockReset();
  attachmentFindMany.mockReset().mockResolvedValue([]);
  attachmentCreate
    .mockReset()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: "att1",
      ...data,
    }));
});

describe("media.generateStills", () => {
  it("queues a PENDING job for the worker instead of generating inline", async () => {
    const caller = mediaRouter.createCaller({ user });
    const result = await caller.generateStills({
      projectId: "proj1",
      prompt: "matte charcoal finish on a walnut desk",
      roles: ["HERO", "DETAIL"],
      aspectRatio: "16:9",
    });

    expect(result).toEqual({ jobId: "job1", status: "PENDING" });
    expect(jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "GENERATE_STILLS",
        status: "PENDING",
        projectId: "proj1",
        releaseId: "rel1",
      }),
    });
    expect(enqueueMediaJob).toHaveBeenCalledWith("job1");
    expect(mediaCreate).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "MediaJobStarted" }),
    );
  });

  it("fails the job row when the queue is unreachable", async () => {
    enqueueMediaJob.mockRejectedValue(new Error("redis unavailable"));

    const caller = mediaRouter.createCaller({ user });
    await expect(
      caller.generateStills({
        projectId: "proj1",
        prompt: "matte charcoal finish on a walnut desk",
        roles: ["HERO"],
      }),
    ).rejects.toThrow(/redis unavailable/);

    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    // A job nobody will run must not look started.
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "MediaJobStarted" }),
    );
  });
});

describe("media.generateVideo", () => {
  it("rejects a seed that is not a still in this project", async () => {
    mediaFindUnique.mockResolvedValue({ projectId: "other", kind: "STILL" });

    const caller = mediaRouter.createCaller({ user });
    await expect(
      caller.generateVideo({
        projectId: "proj1",
        prompt: "slow orbit around the product",
        seedMediaId: "media9",
        durationSec: 6,
      }),
    ).rejects.toThrow(/Seed image not found/);
    expect(enqueueMediaJob).not.toHaveBeenCalled();
  });
});

describe("media.setApproval", () => {
  it("refuses to approve a SIMULATED asset for marketing", async () => {
    mediaFindUnique.mockResolvedValue({
      id: "media1",
      workspaceId: "ws1",
      projectId: "proj1",
      approval: "DRAFT",
      simulated: true,
    });

    const caller = mediaRouter.createCaller({ user });
    await expect(
      caller.setApproval({ mediaId: "media1", approval: "APPROVED_FOR_MARKETING" }),
    ).rejects.toThrow(/SIMULATED/);
    expect(mediaUpdate).not.toHaveBeenCalled();
  });

  it("approves real assets and audits the transition", async () => {
    mediaFindUnique.mockResolvedValue({
      id: "media1",
      workspaceId: "ws1",
      projectId: "proj1",
      approval: "DRAFT",
      simulated: false,
    });
    mediaUpdate.mockResolvedValue({
      id: "media1",
      storageKey: "projects/proj1/media/job1/0-hero.png",
      posterStorageKey: null,
      approval: "APPROVED_FOR_MARKETING",
    });

    const caller = mediaRouter.createCaller({ user });
    const updated = await caller.setApproval({
      mediaId: "media1",
      approval: "APPROVED_FOR_MARKETING",
    });

    expect(updated.url).toBe("/api/files/projects/proj1/media/job1/0-hero.png");
    expect(requireWorkspaceCapability).toHaveBeenCalledWith(
      "user1",
      "ws1",
      "site.publish",
      "proj1",
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ProductMediaApprovalChanged",
        payload: expect.objectContaining({ to: "APPROVED_FOR_MARKETING" }),
      }),
    );
  });
});

describe("media.attach", () => {
  beforeEach(() => {
    siteFindUnique.mockResolvedValue({
      id: "site1",
      workspaceId: "ws1",
      projectId: "proj1",
    });
  });

  it("refuses unapproved media", async () => {
    mediaFindUnique.mockResolvedValue({
      id: "media1",
      workspaceId: "ws1",
      kind: "STILL",
      approval: "DRAFT",
    });

    const caller = mediaRouter.createCaller({ user });
    await expect(
      caller.attach({ siteId: "site1", mediaId: "media1", slot: "HERO" }),
    ).rejects.toThrow(/Approve this asset/);
  });

  it("enforces slot kind rules", async () => {
    mediaFindUnique.mockResolvedValue({
      id: "media1",
      workspaceId: "ws1",
      kind: "VIDEO",
      approval: "APPROVED_FOR_MARKETING",
    });

    const caller = mediaRouter.createCaller({ user });
    await expect(
      caller.attach({ siteId: "site1", mediaId: "media1", slot: "HERO" }),
    ).rejects.toThrow(/accepts STILL/);
  });

  it("appends to the end of a slot", async () => {
    mediaFindUnique.mockResolvedValue({
      id: "media2",
      workspaceId: "ws1",
      kind: "STILL",
      approval: "APPROVED_FOR_MARKETING",
    });
    attachmentFindMany.mockResolvedValue([{ slot: "GALLERY", media: { kind: "STILL" } }]);

    const caller = mediaRouter.createCaller({ user });
    const attachment = await caller.attach({
      siteId: "site1",
      mediaId: "media2",
      slot: "GALLERY",
      altText: "Rover on a desk",
    });

    expect(attachment.sortOrder).toBe(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SiteMediaAttached" }),
    );
  });
});
