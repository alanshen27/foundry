-- Apply with the normal database deployment process before enabling live editors.
-- Existing code/design data is seeded lazily on first edit or room load.
CREATE TABLE IF NOT EXISTS "CollaborationDocument" (
  "documentName" TEXT PRIMARY KEY,
  "state" BYTEA NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
