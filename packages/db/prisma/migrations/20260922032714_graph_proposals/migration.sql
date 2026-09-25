-- CreateEnum
CREATE TYPE "GraphProposalKind" AS ENUM ('LINK', 'TASK', 'RISK');

-- CreateEnum
CREATE TYPE "GraphProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "GraphProposal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "GraphProposalKind" NOT NULL,
    "status" "GraphProposalStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "resultNodeId" TEXT,
    "resultEdgeId" TEXT,

    CONSTRAINT "GraphProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GraphProposal_projectId_branchId_status_idx" ON "GraphProposal"("projectId", "branchId", "status");

-- AddForeignKey
ALTER TABLE "GraphProposal" ADD CONSTRAINT "GraphProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
