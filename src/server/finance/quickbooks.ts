import { Prisma } from "@/generated/prisma/client";
import { HealthStatus, TransactionSource } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/authz/permissions";
import {
  getQuickBooks,
  type ImportedTransaction,
  IntegrationUnavailableError,
} from "@/server/integrations";

const DAY = 86_400_000;
/** Re-read a week before the last sync so late edits in QuickBooks are picked up. */
const OVERLAP_DAYS = 7;
const FIRST_SYNC_DAYS = 180;

/**
 * Read-only QuickBooks sync: reads transactions and stores them here. Nothing is written to
 * QuickBooks. Re-running is safe: rows are matched on their QuickBooks id, so nothing is
 * duplicated. If QuickBooks is down, the page keeps showing the last synced data.
 */
export async function syncQuickBooks(actor: Actor, client: Db = db) {
  authorize(actor, "finance.view");
  const integration = await client.integration.findUnique({ where: { provider: "QUICKBOOKS" } });
  if (!integration) throw new IntegrationUnavailableError("QuickBooks is not set up.");
  const config = (integration.config ?? {}) as Record<string, unknown>;
  const lastSyncAt = typeof config.lastSyncAt === "string" ? new Date(config.lastSyncAt) : null;
  const since = lastSyncAt
    ? new Date(lastSyncAt.getTime() - OVERLAP_DAYS * DAY)
    : new Date(Date.now() - FIRST_SYNC_DAYS * DAY);

  let imported: ImportedTransaction[];
  try {
    imported = await getQuickBooks().fetchTransactions(since);
  } catch (error) {
    const message =
      error instanceof IntegrationUnavailableError
        ? error.message
        : "QuickBooks did not respond. Showing the last synced data.";
    await client.integration.update({
      where: { id: integration.id },
      data: { status: HealthStatus.DOWN, lastCheckedAt: new Date(), lastError: message },
    });
    throw new IntegrationUnavailableError(message);
  }

  const syncedAt = new Date();
  return client.$transaction(async (tx) => {
    const { created, updated } = await storeTransactions(tx, imported);
    const total = await tx.transaction.count({ where: { source: TransactionSource.QUICKBOOKS } });
    await tx.integration.update({
      where: { id: integration.id },
      data: {
        status: HealthStatus.OPERATIONAL,
        lastCheckedAt: syncedAt,
        lastError: null,
        config: { ...config, lastSyncAt: syncedAt.toISOString(), syncedTransactions: total },
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "integration.synced",
      entityType: "Integration",
      entityId: integration.id,
      after: {
        provider: "QUICKBOOKS",
        mode: getQuickBooks().mode,
        since: since.toISOString(),
        created,
        updated,
      },
    });
    return { syncedAt, created, updated };
  });
}

/** Insert new transactions and refresh changed ones, matched on externalId. */
export async function storeTransactions(
  tx: Parameters<Parameters<Db["$transaction"]>[0]>[0],
  rows: ImportedTransaction[],
) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const data = {
      occurredAt: row.occurredAt,
      description: row.description.slice(0, 200),
      category: row.category.slice(0, 80),
      type: row.type,
      amountUsd: new Prisma.Decimal(row.amountUsd.toFixed(2)),
      source: TransactionSource.QUICKBOOKS,
    };
    const existing = await tx.transaction.findUnique({
      where: { externalId: row.externalId },
      select: { id: true, amountUsd: true, description: true, type: true },
    });
    if (!existing) {
      await tx.transaction.create({ data: { ...data, externalId: row.externalId } });
      created++;
    } else if (
      !existing.amountUsd.equals(data.amountUsd) ||
      existing.description !== data.description ||
      existing.type !== data.type
    ) {
      await tx.transaction.update({ where: { id: existing.id }, data });
      updated++;
    }
  }
  return { created, updated };
}
