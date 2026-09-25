-- CreateEnum
CREATE TYPE "ProductNodeKind" AS ENUM ('REQUIREMENT', 'COMPONENT', 'CHECK', 'FIRMWARE_FILE', 'CIRCUIT_PART', 'NET', 'FOOTPRINT', 'MCU_PIN', 'CAD_PART', 'CAD_ASSEMBLY', 'BRIEF', 'TASK', 'RISK', 'DECISION');

-- CreateEnum
CREATE TYPE "GraphOrigin" AS ENUM ('DERIVED', 'USER', 'AGENT', 'IMPORT');

-- CreateEnum
CREATE TYPE "ProductEdgeKind" AS ENUM ('SATISFIES', 'VERIFIED_BY', 'IMPLEMENTED_BY', 'REALIZED_BY', 'CONNECTS', 'DRIVES', 'HOUSES', 'CONTAINS', 'POWERS', 'DEPENDS_ON', 'DERIVED_FROM', 'MITIGATES');

-- AlterTable
ALTER TABLE "Component" ADD COLUMN     "capacityMah" DOUBLE PRECISION,
ADD COLUMN     "currentDrawMa" DOUBLE PRECISION,
ADD COLUMN     "nominalVoltageV" DOUBLE PRECISION,
ADD COLUMN     "peakCurrentMa" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ProductNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "ProductNodeKind" NOT NULL,
    "refKey" TEXT NOT NULL,
    "refId" TEXT,
    "label" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "origin" "GraphOrigin" NOT NULL DEFAULT 'DERIVED',
    "originDetail" TEXT,
    "createdById" TEXT,
    "contentHash" TEXT,
    "staleAt" TIMESTAMP(3),
    "staleReason" TEXT,
    "staleFromId" TEXT,
    "staleDepth" INTEGER,
    "staleConfidence" DOUBLE PRECISION,
    "staleContentHash" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEdge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" "ProductEdgeKind" NOT NULL,
    "origin" "GraphOrigin" NOT NULL DEFAULT 'DERIVED',
    "rule" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidence" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductNode_projectId_branchId_kind_idx" ON "ProductNode"("projectId", "branchId", "kind");

-- CreateIndex
CREATE INDEX "ProductNode_projectId_branchId_staleAt_idx" ON "ProductNode"("projectId", "branchId", "staleAt");

-- CreateIndex
CREATE INDEX "ProductNode_projectId_branchId_origin_idx" ON "ProductNode"("projectId", "branchId", "origin");

-- CreateIndex
CREATE INDEX "ProductNode_refId_idx" ON "ProductNode"("refId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductNode_projectId_branchId_refKey_key" ON "ProductNode"("projectId", "branchId", "refKey");

-- CreateIndex
CREATE INDEX "ProductEdge_projectId_branchId_fromId_idx" ON "ProductEdge"("projectId", "branchId", "fromId");

-- CreateIndex
CREATE INDEX "ProductEdge_projectId_branchId_toId_idx" ON "ProductEdge"("projectId", "branchId", "toId");

-- CreateIndex
CREATE INDEX "ProductEdge_projectId_branchId_origin_idx" ON "ProductEdge"("projectId", "branchId", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEdge_fromId_toId_kind_key" ON "ProductEdge"("fromId", "toId", "kind");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId");

-- CreateIndex
CREATE INDEX "ChatRun_projectId_branchId_status_idx" ON "ChatRun"("projectId", "branchId", "status");

-- AddForeignKey
ALTER TABLE "ProductNode" ADD CONSTRAINT "ProductNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEdge" ADD CONSTRAINT "ProductEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "ProductNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEdge" ADD CONSTRAINT "ProductEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "ProductNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

