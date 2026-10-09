-- Durable Yjs state for engineering collaboration rooms.
-- Idempotent: environments that already applied the former hand-run
-- prisma/changes/20260911-collaboration.sql converge on the same table.
CREATE TABLE IF NOT EXISTS "CollaborationDocument" (
    "documentName" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollaborationDocument_pkey" PRIMARY KEY ("documentName")
);

-- The hand-run script declared a default that schema.prisma does not.
ALTER TABLE "CollaborationDocument" ALTER COLUMN "updatedAt" DROP DEFAULT;
