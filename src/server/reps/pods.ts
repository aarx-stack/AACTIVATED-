/**
 * Rep pods: each rep's private AI team.
 *
 * "Carry forward what was learned": when a pod agent is created it copies the
 * template's CURRENT version (role, context, routine, tools) and records which
 * version it came from. Premium reps get four agents; free reps get the
 * Business Coach only. Downgrades pause agents instead of deleting history.
 */
import type { Role } from "@/generated/prisma/enums";
import { AgentKind, AgentStatus, RepAgentRole } from "@/generated/prisma/enums";
import type { DbClient } from "@/lib/db";
import { recordAudit, type AuditActor } from "@/server/audit/audit";

export const POD_ROLES: Record<Role, RepAgentRole[]> = {
  PREMIUM_REP: [
    RepAgentRole.CONTENT_CREATOR,
    RepAgentRole.SOCIAL_MEDIA_MANAGER,
    RepAgentRole.LEAD_FOLLOWUP,
    RepAgentRole.BUSINESS_COACH,
  ],
  FREE_REP: [RepAgentRole.BUSINESS_COACH],
  EXECUTIVE: [],
  STAFF: [],
  SYSTEM_ADMIN: [],
};

export const REP_ROLE_LABEL: Record<RepAgentRole, string> = {
  CONTENT_CREATOR: "Content Creator",
  SOCIAL_MEDIA_MANAGER: "Social Media Manager",
  LEAD_FOLLOWUP: "Lead Follow-up Specialist",
  BUSINESS_COACH: "Business Coach",
};

export function podAgentSlug(repId: string, role: RepAgentRole) {
  return `pod-${repId}-${role.toLowerCase().replace(/_/g, "-")}`;
}

export interface PodSyncResult {
  podId: string;
  created: RepAgentRole[];
  resumed: RepAgentRole[];
  paused: RepAgentRole[];
}

/** Brings a rep's pod in line with their role. Call inside a transaction. */
export async function syncRepPod(
  tx: DbClient,
  repId: string,
  actor: AuditActor,
): Promise<PodSyncResult> {
  const rep = await tx.user.findUniqueOrThrow({
    where: { id: repId },
    select: { id: true, role: true },
  });
  const required = new Set(POD_ROLES[rep.role]);
  const pod = await tx.repPod.upsert({ where: { repId }, create: { repId }, update: {} });
  const existing = await tx.agent.findMany({ where: { repPodId: pod.id } });
  const result: PodSyncResult = { podId: pod.id, created: [], resumed: [], paused: [] };

  for (const role of required) {
    const agent = existing.find((a) => a.repRole === role);
    if (agent) {
      if (agent.status === AgentStatus.PAUSED) {
        await tx.agent.update({ where: { id: agent.id }, data: { status: AgentStatus.ACTIVE } });
        result.resumed.push(role);
      }
      continue;
    }
    const template = await tx.agentTemplate.findFirst({ where: { repRole: role } });
    if (!template) throw new Error(`No agent template for ${role}.`);
    const version = await tx.agentTemplateVersion.findUniqueOrThrow({
      where: { templateId_version: { templateId: template.id, version: template.currentVersion } },
    });
    const agent2 = await tx.agent.create({
      data: {
        slug: podAgentSlug(repId, role),
        name: REP_ROLE_LABEL[role],
        title: REP_ROLE_LABEL[role],
        kind: AgentKind.REP_POD,
        status: AgentStatus.ACTIVE,
        repPodId: pod.id,
        repRole: role,
        ownerId: repId,
        templateVersionId: version.id,
        config: {
          role: version.role,
          context: version.context,
          dailyRoutine: version.dailyRoutine,
          toolsAllowed: version.toolsAllowed,
        },
      },
    });
    await recordAudit(tx, {
      actor,
      action: "rep_pod.agent_created",
      entityType: "Agent",
      entityId: agent2.id,
      after: { repId, role, template: template.key, version: version.version },
    });
    result.created.push(role);
  }

  for (const agent of existing) {
    if (agent.repRole && !required.has(agent.repRole) && agent.status !== AgentStatus.PAUSED) {
      await tx.agent.update({ where: { id: agent.id }, data: { status: AgentStatus.PAUSED } });
      await recordAudit(tx, {
        actor,
        action: "rep_pod.agent_paused",
        entityType: "Agent",
        entityId: agent.id,
        before: { status: agent.status },
        after: { status: AgentStatus.PAUSED, reason: "Role no longer includes this agent." },
      });
      result.paused.push(agent.repRole);
    }
  }
  return result;
}

/** The rep's pod agent for a role, or null if their plan does not include it. */
export async function getPodAgent(client: DbClient, repId: string, role: RepAgentRole) {
  return client.agent.findFirst({
    where: { repRole: role, repPod: { repId }, status: { not: AgentStatus.PAUSED } },
    select: { id: true, name: true, title: true, status: true, config: true, departmentId: true },
  });
}
