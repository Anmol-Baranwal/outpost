-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "confidenceLevel" TEXT,
ADD COLUMN     "confidenceScore" DOUBLE PRECISION,
ADD COLUMN     "externalCommentId" TEXT,
ADD COLUMN     "feedback" TEXT;

-- CreateIndex
CREATE INDEX "Message_isAiGenerated_feedback_idx" ON "Message"("isAiGenerated", "feedback");
