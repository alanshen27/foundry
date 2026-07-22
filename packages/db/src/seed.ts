/**
 * Idempotent seed for local development and e2e tests.
 * Creates two LOCAL users (builder + reviewer), a demo workspace, and a demo
 * project with a main branch and all four stage rows.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const builder = await prisma.user.upsert({
    where: { email: "builder@foundry.local" },
    update: {},
    create: {
      email: "builder@foundry.local",
      name: "Demo Builder",
      localPasswordHash: hashPassword("demo-password"),
    },
  });

  await prisma.user.upsert({
    where: { email: "reviewer@foundry.local" },
    update: {},
    create: {
      email: "reviewer@foundry.local",
      name: "Demo Reviewer",
      localPasswordHash: hashPassword("demo-password"),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo-workspace" },
    update: {},
    create: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      createdById: builder.id,
      memberships: { create: { userId: builder.id, role: "OWNER" } },
    },
  });

  const existingProject = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: "palm-rover" } },
  });

  if (!existingProject) {
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: "Palm Rover",
        slug: "palm-rover",
        description: "Palm-sized two-wheel autonomous rover (PRD seed demo project).",
        createdById: builder.id,
      },
    });
    const branch = await prisma.projectBranch.create({
      data: { projectId: project.id, name: "main", isDefault: true, createdById: builder.id },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { activeBranchId: branch.id },
    });
    await prisma.stageState.createMany({
      data: (["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"] as const).map((stage) => ({
        projectId: project.id,
        branchId: branch.id,
        stage,
      })),
    });
    await prisma.auditEvent.create({
      data: {
        type: "ProjectCreated",
        workspaceId: workspace.id,
        projectId: project.id,
        branchId: branch.id,
        actorId: builder.id,
        actorType: "SYSTEM",
        payload: { seed: true, name: project.name },
      },
    });
  }

  console.log("Seed complete: builder@foundry.local / reviewer@foundry.local (demo-password)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
