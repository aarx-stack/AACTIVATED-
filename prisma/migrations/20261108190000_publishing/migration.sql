-- CreateEnum
CREATE TYPE "PublicationKind" AS ENUM ('ARTICLE', 'EBOOK', 'BOOK');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFTING', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'PUBLICATION';

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "kind" "PublicationKind" NOT NULL,
    "audience" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFTING',
    "authorId" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "approvedHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationSection" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "writtenBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Publication_approvalRequestId_key" ON "Publication"("approvalRequestId");

-- CreateIndex
CREATE INDEX "Publication_status_updatedAt_idx" ON "Publication"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PublicationSection_publicationId_position_idx" ON "PublicationSection"("publicationId", "position");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSection" ADD CONSTRAINT "PublicationSection_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

