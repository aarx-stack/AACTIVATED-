-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "correlationId" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "correlationId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
