-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "output" JSONB,
ADD COLUMN     "outputAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_provider_key" ON "IntegrationConnection"("provider");

-- CreateIndex
CREATE INDEX "RateLimitHit_key_createdAt_idx" ON "RateLimitHit"("key", "createdAt");


-- Data: every company agent may work prompt tasks sent from the Prompt Generator.
UPDATE "Agent"
SET "config" = jsonb_set(
  "config",
  '{toolsAllowed}',
  COALESCE("config"->'toolsAllowed', '[]'::jsonb) || '["tasks.work"]'::jsonb
)
WHERE "kind" <> 'REP_POD'
  AND NOT COALESCE("config"->'toolsAllowed', '[]'::jsonb) ? 'tasks.work';
