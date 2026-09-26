import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Stage, StageStatus } from "@foundry/domain";

const access = vi.fn();
const audit = vi.fn();
const checkCreate = vi.fn();
const checkUpdate = vi.fn();
const checkDelete = vi.fn();
const checkUpdateMany = vi.fn();
const releaseCreate = vi.fn();
const stageUpdate = vi.fn();
type Check = {
  id: string;
  projectId: string;
  branchId: string;
  title: string;
  status: string;
  waived: boolean;
  [field: string]: unknown;
};
type State = {
  id: string;
  stage: Stage;
  status: StageStatus;
  approvedById: string | null;
  approvedAt: Date | null;
};
let checks: Check[];
let states: Record<string, State>;
const db = {
  validationCheck: {
    findUnique: vi.fn(
      ({ where }: { where: { id: string } }) => checks.find((c) => c.id === where.id) ?? null,
    ),
    findMany: vi.fn(() => checks),
    create: (...args: unknown[]) => checkCreate(...args),
    update: (...args: unknown[]) => checkUpdate(...args),
    delete: (...args: unknown[]) => checkDelete(...args),
    updateMany: (...args: unknown[]) => checkUpdateMany(...args),
  },
  stageState: {
    findUnique: vi.fn(
      ({ where }: { where: { projectId_branchId_stage: { stage: Stage } } }) =>
        states[where.projectId_branchId_stage.stage] ?? null,
    ),
    findMany: vi.fn(
      ({ where }: { where: { stage: { in: Stage[] }; status: { in: StageStatus[] } } }) =>
        Object.values(states).filter(
          (s) => where.stage.in.includes(s.stage) && where.status.in.includes(s.status),
        ),
    ),
    update: (...args: unknown[]) => stageUpdate(...args),
    updateMany: vi.fn(),
  },
  release: {
    findUnique: vi.fn(() => null),
    create: (...args: unknown[]) => releaseCreate(...args),
  },
  requirement: { findMany: vi.fn(() => []) },
  component: { findMany: vi.fn(() => []) },
  repoLink: { findMany: vi.fn(() => []) },
  designDoc: { findMany: vi.fn(() => []) },
  projectBrief: { findUnique: vi.fn(() => null) },
};
vi.mock("@foundry/db", () => ({ prisma: db }));
vi.mock("@/server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => access(...args),
}));
vi.mock("@/server/audit", () => ({ recordAudit: (...args: unknown[]) => audit(...args) }));
vi.mock("@/server/session", () => ({ getCurrentUser: vi.fn() }));
const { verifyRouter } = await import("@/server/routers/verify");
const { launchRouter } = await import("@/server/routers/launch");
const { markDownstreamStale } = await import("@/server/stage-state");
const user = {
  id: "user",
  name: "User",
  email: "user@example.com",
  avatarUrl: null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};
const scope = { projectId: "project", branchId: "branch" };
const verify = () => verifyRouter.createCaller({ user });
const launch = () => launchRouter.createCaller({ user });
const releaseInput = { ...scope, version: "1.0.0" };

beforeEach(() => {
  vi.clearAllMocks();
  checks = [{ id: "check", ...scope, title: "Measured clearance", status: "PASS", waived: false }];
  states = Object.fromEntries(
    (["VERIFY", "LAUNCH"] as const).map((stage) => [
      stage,
      {
        id: stage,
        stage,
        status: "APPROVED",
        approvedById: "reviewer",
        approvedAt: new Date("2026-01-01"),
      },
    ]),
  );
  access.mockResolvedValue({
    project: { id: scope.projectId, name: "Project", slug: "project", workspaceId: "workspace" },
  });
  stageUpdate.mockImplementation(
    ({ where, data }: { where: { id: string }; data: Partial<State> }) => {
      const state = states[where.id]!;
      states[where.id] = { ...state, ...data };
      return states[where.id];
    },
  );
  checkCreate.mockImplementation(({ data }: { data: Omit<Check, "id" | "status" | "waived"> }) => {
    const check = { id: "new", status: "PENDING", waived: false, ...data };
    checks.push(check as Check);
    return check;
  });
  checkUpdate.mockImplementation(
    ({ where, data }: { where: { id: string }; data: Partial<Check> }) => {
      const next = { ...checks.find((c) => c.id === where.id)!, ...data };
      checks = checks.map((c) => (c.id === where.id ? next : c));
      return next;
    },
  );
  checkDelete.mockImplementation(({ where }: { where: { id: string } }) => {
    checks = checks.filter((c) => c.id !== where.id);
    return { id: where.id };
  });
  checkUpdateMany.mockImplementation(
    ({
      where,
      data,
    }: {
      where: { OR: [{ status: { in: string[] } }, { waived: boolean }] };
      data: Partial<Check>;
    }) => {
      let count = 0;
      checks = checks.map((check) => {
        if (!where.OR[0].status.in.includes(check.status) && !check.waived) return check;
        count += 1;
        return { ...check, ...data };
      });
      return { count };
    },
  );
  releaseCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "release",
    ...data,
  }));
});

function expectInvalidated() {
  for (const stage of ["VERIFY", "LAUNCH"]) {
    expect(states[stage]).toMatchObject({ status: "STALE", approvedById: null, approvedAt: null });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "StageStatusChanged",
        ...scope,
        payload: { stage, from: "APPROVED", to: "STALE" },
      }),
    );
  }
}

describe("verification edits invalidate approved snapshots", () => {
  it.each([
    ["result", { status: "FAIL" as const }],
    ["evidence", { evidence: "Corrected instrument reading" }],
    ["scope", { targetPath: "parts/other.kcl" }],
    ["title", { title: "New validation scope" }],
  ])("invalidates approval when a check's %s changes", async (_label, fields) => {
    await verify().updateCheck({ id: "check", ...fields });
    expectInvalidated();
    expect(access).toHaveBeenCalledWith("user", "project", "verification.run");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ type: "ValidationCheckUpdated" }));
    await expect(launch().createRelease(releaseInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(releaseCreate).not.toHaveBeenCalled();
  });

  it("invalidates approval when a pending check is added", async () => {
    await verify().createCheck({ ...scope, title: "New check" });
    expectInvalidated();
    expect(checks.at(-1)?.status).toBe("PENDING");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ type: "ValidationCheckCreated" }));
  });

  it("invalidates approval even when deleting the last passing check", async () => {
    await verify().deleteCheck({ id: "check" });
    expect(checks).toEqual([]);
    expectInvalidated();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ type: "ValidationCheckDeleted" }));
  });

  it.each([true, false])("invalidates approval when waived becomes %s", async (waived) => {
    checks[0]!.waived = !waived;
    await verify().waiveCheck({
      id: "check",
      waived,
      waiverReason: waived ? "Accepted with independent measurement" : undefined,
    });
    expectInvalidated();
    expect(access).toHaveBeenCalledWith("user", "project", "verification.approve");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ type: "ValidationCheckWaived" }));
  });

  it("keeps valid draft work moving to RUNNING on result edits", async () => {
    states.VERIFY!.status = "DRAFT";
    await verify().updateCheck({ id: "check", status: "WARNING" });
    expect(states.VERIFY).toMatchObject({
      status: "RUNNING",
      approvedById: null,
      approvedAt: null,
    });
  });

  it("starts the stage at DRAFT when the first check is created", async () => {
    states.VERIFY!.status = "NOT_STARTED";
    await verify().createCheck({ ...scope, title: "First check" });
    expect(states.VERIFY?.status).toBe("DRAFT");
  });

  it("requires authentication and capabilities before edits or invalidation", async () => {
    await expect(
      verifyRouter.createCaller({ user: null }).updateCheck({ id: "check", status: "FAIL" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    access.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN" }));
    await expect(verify().updateCheck({ id: "check", status: "FAIL" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(checkUpdate).not.toHaveBeenCalled();
    expect(stageUpdate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("approval and release use current check results", () => {
  it("requires checks to run again after engineering edits while retaining historical evidence", async () => {
    checks = ["PASS", "WARNING", "SIMULATED", "SKIPPED", "FAIL", "ERROR", "PENDING"].map(
      (status) => ({
        id: status,
        ...scope,
        title: `${status} measurement`,
        status,
        waived: false,
        evidence: "Previous source measurement",
      }),
    );
    checks.push({
      id: "waived",
      ...scope,
      title: "Accepted limitation",
      status: "FAIL",
      waived: true,
      waiverReason: "Previous design exception",
      approvedById: "reviewer",
      approvedAt: new Date(),
    });
    await markDownstreamStale({
      ...scope,
      workspaceId: "workspace",
      actorId: "user",
      changedStage: "ENGINEER",
    });
    expectInvalidated();
    expect(checkUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining(scope) }),
    );
    for (const id of ["PASS", "WARNING", "SIMULATED", "SKIPPED", "waived"]) {
      expect(checks.find((check) => check.id === id)).toMatchObject({
        status: "PENDING",
        waived: false,
        waiverReason: null,
        approvedById: null,
        approvedAt: null,
      });
    }
    expect(checks.find((check) => check.id === "PASS")?.evidence).toBe(
      "Previous source measurement",
    );
    expect(checks.find((check) => check.id === "FAIL")?.status).toBe("FAIL");
    expect(checks.find((check) => check.id === "ERROR")?.status).toBe("ERROR");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ValidationCheckUpdated",
        payload: expect.objectContaining({ action: "source_changed", resetCount: 5 }),
      }),
    );
    await expect(verify().approve(scope)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not reset check results when only verification content changes", async () => {
    await markDownstreamStale({
      ...scope,
      workspaceId: "workspace",
      actorId: "user",
      changedStage: "VERIFY",
    });
    expect(checkUpdateMany).not.toHaveBeenCalled();
    expect(checks[0]?.status).toBe("PASS");
  });

  it.each(["PENDING", "FAIL", "ERROR", "SIMULATED"])(
    "blocks unwaived %s at approval and at release despite an old approved stage",
    async (status) => {
      checks[0]!.status = status;
      await expect(verify().approve(scope)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(launch().createRelease(releaseInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(releaseCreate).not.toHaveBeenCalled();
    },
  );

  it("blocks approval and release with zero checks", async () => {
    checks = [];
    await expect(verify().approve(scope)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(launch().createRelease(releaseInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(releaseCreate).not.toHaveBeenCalled();
  });

  it.each(["PASS", "WARNING", "SKIPPED"])(
    "allows current %s results and records their release snapshot",
    async (status) => {
      checks[0]!.status = status;
      const released = await launch().createRelease(releaseInput);
      expect(released).toMatchObject({
        id: "release",
        snapshot: { validationChecks: checks, summary: { checks: 1 } },
      });
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ type: "ReleaseCreated" }));
    },
  );

  it("requires explicit waiver and reapproval for a simulated result", async () => {
    checks[0]!.status = "SIMULATED";
    await verify().waiveCheck({
      id: "check",
      waived: true,
      waiverReason: "Prototype only; release records this waiver",
    });
    await expect(launch().createRelease(releaseInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await verify().approve(scope);
    const released = await launch().createRelease(releaseInput);
    expect(released).toMatchObject({
      snapshot: {
        validationChecks: [expect.objectContaining({ status: "SIMULATED", waived: true })],
        summary: { checksPassed: 0, checksWaived: 1 },
      },
    });
  });
});
