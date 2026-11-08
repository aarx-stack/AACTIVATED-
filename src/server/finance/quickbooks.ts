import { HealthStatus } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/authz/permissions";
import { getQuickBooks, IntegrationUnavailableError } from "@/server/integrations";

/**
 * Read-only QuickBooks sync. Nothing is written to QuickBooks. In mock mode this refreshes the
 * sync timestamp; if QuickBooks is down, the page keeps showing the last synced data.
 */
export async function syncQuickBooks(actor: Actor, client: Db = db) {
  authorize(actor, "finance.view");
  const integration = await client.integration.findUnique({ where: { provider: "QUICKBOOKS" } });
  if (!integration) throw new IntegrationUnavailableError("QuickBooks is not set up.");
  const config = (integration.config ?? {}) as Record<string, unknown>;
  try {
    const result = await getQuickBooks().lastSync();
    const syncedAt = result.syncedAt ?? new Date();
    await client.$transaction(async (tx) => {
      await tx.integration.update({
        where: { id: integration.id },
        data: {
          status: HealthStatus.OPERATIONAL,
          lastCheckedAt: new Date(),
          lastError: null,
          config: { ...config, lastSyncAt: syncedAt.toISOString() },
        },
      });
      await recordAudit(tx, {
        actor: { type: "USER", userId: actor.id },
        action: "integration.synced",
        entityType: "Integration",
        entityId: integration.id,
        after: { provider: "QUICKBOOKS", mode: integration.mode, syncedAt },
      });
    });
    return { syncedAt };
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
}
