-- AlterTable
ALTER TABLE "SpendEvent" ADD COLUMN     "approvalRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SpendEvent_approvalRequestId_key" ON "SpendEvent"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "SpendEvent" ADD CONSTRAINT "SpendEvent_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

