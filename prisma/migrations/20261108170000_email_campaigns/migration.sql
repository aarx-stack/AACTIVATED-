-- CreateEnum
CREATE TYPE "EmailAudience" AS ENUM ('CLINICS', 'MEMBERS', 'REPS', 'MY_CONTACTS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SENDING', 'SENT', 'REJECTED');

-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "EmailCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" "EmailAudience" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "repId" TEXT,
    "approvalRequestId" TEXT,
    "recipientEstimate" INTEGER,
    "sentAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "status" "EmailSendStatus" NOT NULL,
    "reason" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailCampaign_approvalRequestId_key" ON "EmailCampaign"("approvalRequestId");

-- CreateIndex
CREATE INDEX "EmailCampaign_status_createdAt_idx" ON "EmailCampaign"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailCampaign_repId_idx" ON "EmailCampaign"("repId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSend_campaignId_recipientKey_key" ON "EmailSend"("campaignId", "recipientKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_emailHash_key" ON "EmailSuppression"("emailHash");

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

