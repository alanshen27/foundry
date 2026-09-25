-- AlterTable
ALTER TABLE "ChatRun" ADD COLUMN     "cachedInputTokens" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "reasoningTokens" INTEGER,
ADD COLUMN     "stepCount" INTEGER,
ADD COLUMN     "totalTokens" INTEGER;

-- CreateIndex
CREATE INDEX "ChatRun_projectId_createdAt_idx" ON "ChatRun"("projectId", "createdAt");

