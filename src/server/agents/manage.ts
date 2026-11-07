import { AgentStatus } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";

/** Executives pause or resume an agent. Paused agents take no work (see runner.ts). */
export async function setAgentPaused(
  actor: Actor,
  agentId: string,
  paused: boolean,
  client: Db = db,
) {
  authorize(actor, "agent.manage");
  return client.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new ForbiddenError("Agent not found.");
    const status = paused ? AgentStatus.PAUSED : AgentStatus.ACTIVE;
    const updated = await tx.agent.update({ where: { id: agentId }, data: { status } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: paused ? "agent.paused" : "agent.resumed",
      entityType: "Agent",
      entityId: agentId,
      before: { status: agent.status },
      after: { status },
    });
    return updated;
  });
}
