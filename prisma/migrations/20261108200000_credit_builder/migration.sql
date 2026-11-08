-- CreateEnum
CREATE TYPE "CreditCategory" AS ENUM ('FOUNDATION', 'BUREAUS', 'TRADELINES', 'MONITORING');

-- CreateEnum
CREATE TYPE "CreditStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "TradelineKind" AS ENUM ('VENDOR_NET30', 'CREDIT_CARD', 'LINE_OF_CREDIT', 'LOAN');

-- CreateEnum
CREATE TYPE "TradelineStatus" AS ENUM ('APPLIED', 'OPEN', 'CLOSED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CreditBureau" AS ENUM ('DNB_PAYDEX', 'EXPERIAN_INTELLISCORE', 'EQUIFAX_BUSINESS', 'FICO_SBSS');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "CreditMilestone" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" "CreditCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CreditStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "notes" TEXT NOT NULL DEFAULT '',
    "completedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tradeline" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "kind" "TradelineKind" NOT NULL,
    "reportsTo" TEXT[],
    "limitUsd" DECIMAL(12,2),
    "openedAt" TIMESTAMP(3),
    "status" "TradelineStatus" NOT NULL DEFAULT 'APPLIED',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tradeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditScore" (
    "id" TEXT NOT NULL,
    "bureau" "CreditBureau" NOT NULL,
    "score" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditMilestone_key_key" ON "CreditMilestone"("key");

-- CreateIndex
CREATE INDEX "CreditScore_bureau_recordedAt_idx" ON "CreditScore"("bureau", "recordedAt");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

