-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "keyPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "summarizedAt" TIMESTAMP(3);

