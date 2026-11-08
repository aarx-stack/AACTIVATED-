import { IntegrationProvider } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";

/** The Admin off switch: when off, every call to the integration is refused (see index.ts). */
export async function setIntegrationEnabled(
  actor: Actor,
  provider: IntegrationProvider,
  enabled: boolean,
  client: Db = db,
) {
  authorize(actor, "integrations.manage");
  if (provider === IntegrationProvider.ANTHROPIC) {
    throw new ForbiddenError("The AI provider is controlled by AI_PROVIDER, not this switch.");
  }
  return client.$transaction(async (tx) => {
    const before = await tx.integration.findUnique({ where: { provider } });
    if (!before) throw new ForbiddenError("That integration does not exist.");
    if (before.enabled === enabled) return before;
    const after = await tx.integration.update({ where: { provider }, data: { enabled } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: enabled ? "integration.enabled" : "integration.disabled",
      entityType: "Integration",
      entityId: before.id,
      before: { enabled: before.enabled },
      after: { enabled },
    });
    return after;
  });
}
