-- CreateEnum
CREATE TYPE "PresenterStatus" AS ENUM ('NONE', 'CANDIDATE', 'PRESENTER');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('WEB_FORM', 'INBOUND_MESSAGE', 'EVENT_SIGNUP', 'REFERRAL_OPT_IN');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'FOLLOWING_UP', 'CONVERTED', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('COMMISSION', 'BONUS', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "contactId" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "externalPostId" TEXT,
ADD COLUMN     "scheduledById" TEXT;

-- CreateTable
CREATE TABLE "RepProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presenterStatus" "PresenterStatus" NOT NULL DEFAULT 'NONE',
    "sponsorId" TEXT,
    "ghlSubAccountId" TEXT,
    "policiesAcceptedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "preferredChannel" "ContentChannel" NOT NULL DEFAULT 'EMAIL',
    "consentSource" "ConsentSource" NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentEvidence" TEXT NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "ghlContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Earning" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "kind" "EarningKind" NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "amountUsd" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Earning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "amountUsd" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepProfile_userId_key" ON "RepProfile"("userId");

-- CreateIndex
CREATE INDEX "RepProfile_sponsorId_idx" ON "RepProfile"("sponsorId");

-- CreateIndex
CREATE INDEX "Contact_repId_status_idx" ON "Contact"("repId", "status");

-- CreateIndex
CREATE INDEX "Earning_repId_period_idx" ON "Earning"("repId", "period");

-- CreateIndex
CREATE INDEX "Payout_repId_paidAt_idx" ON "Payout"("repId", "paidAt");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepProfile" ADD CONSTRAINT "RepProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepProfile" ADD CONSTRAINT "RepProfile_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Earning" ADD CONSTRAINT "Earning_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
