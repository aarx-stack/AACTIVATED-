/**
 * Development & Tokenization Map: projects, ideas backlog and gated moves.
 * Rules live in policy.ts. Every change is audited; gated moves go through the Approval Queue
 * (or an executive decision with a written note), and approving applies the move.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ApprovalStatus, ApprovalType, ProjectPhase, RiskLevel } from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import {
  decideAdvance,
  isGatedMove,
  lockedAfterMove,
  MIN_DECISION_NOTE,
  PHASE_LABEL,
  PHASES,
} from "./policy";

const projectInclude = {
  owner: { select: { name: true } },
  approvalRequest: { select: { id: true, status: true, title: true } },
} satisfies Prisma.ProjectInclude;

export type RoadmapStatusFilter = "all" | "active" | "pending" | "launched";

export async function getRoadmap(
  actor: Actor,
  filters: { q?: string; status?: RoadmapStatusFilter } = {},
  client: Db = db,
) {
  authorize(actor, "roadmap.view");
  const term = filters.q?.trim();
  const search: Prisma.ProjectWhereInput = term
    ? {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
        ],
      }
    : {};
  const all = await client.project.findMany({
    where: search,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: projectInclude,
  });
  const pending = (p: (typeof all)[number]) => p.approvalRequest?.status === ApprovalStatus.PENDING;
  const onMap = all
    .filter((p) => p.onMap)
    .filter((p) => {
      switch (filters.status ?? "all") {
        case "active":
          return p.phase !== ProjectPhase.LAUNCH;
        case "pending":
          return pending(p);
        case "launched":
          return p.phase === ProjectPhase.LAUNCH;
        default:
          return true;
      }
    });
  const mapped = all.filter((p) => p.onMap);
  return {
    projects: onMap.map((p) => ({ ...p, pendingApproval: pending(p) })),
    backlog: all.filter((p) => !p.onMap),
    metrics: {
      total: mapped.length,
      inDevelopment: mapped.filter(
        (p) => p.phase === ProjectPhase.BUILD || p.phase === ProjectPhase.REVIEW,
      ).length,
      launched: mapped.filter((p) => p.phase === ProjectPhase.LAUNCH).length,
      pendingApproval: mapped.filter(pending).length,
      byPhase: PHASES.map((phase) => ({
        phase,
        count: mapped.filter((p) => p.phase === phase).length,
      })),
    },
    all: mapped,
  };
}

// ------------------------------------------------------------------ moving --

export const advanceSchema = z.object({
  projectId: z.string().min(1),
  note: z.string().trim().max(1000).optional(),
});

function riskFor(project: { isTokenization: boolean }, to: ProjectPhase): RiskLevel {
  if (project.isTokenization) return RiskLevel.CRITICAL;
  return to === ProjectPhase.LAUNCH ? RiskLevel.HIGH : RiskLevel.MEDIUM;
}

/**
 * Move a project to its next phase. Returns "advanced" when it moved, or "requested" when an
 * executive decision is needed and a request is now waiting in the Approval Queue.
 */
export async function advanceProject(
  actor: Actor & { name?: string | null },
  input: z.input<typeof advanceSchema>,
  client: Db = db,
): Promise<{ status: "advanced" | "requested"; to: ProjectPhase; approvalId?: string }> {
  authorize(actor, "roadmap.view");
  const { projectId, note } = advanceSchema.parse(input);

  return client.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { approvalRequest: { select: { id: true, status: true } } },
    });
    if (!project || !project.onMap) throw new ForbiddenError("That project is not on the map.");
    const decision = decideAdvance(actor.role, project);
    if (decision.action === "refuse") throw new ForbiddenError(decision.reason);

    if (decision.action === "request") {
      if (project.approvalRequest?.status === ApprovalStatus.PENDING) {
        throw new ForbiddenError("A request for this project is already waiting for a decision.");
      }
      const { submitApproval } = await import("@/server/approvals/service");
      const payload = {
        projectId: project.id,
        project: project.name,
        from: project.phase,
        to: decision.to,
      };
      const why = project.isTokenization
        ? "The tokenization platform is mapped only: every step needs an executive decision, and legal review comes first."
        : project.locked
          ? "This project is locked until an executive approves the next step."
          : "Launching this project needs executive approval.";
      const request = await submitApproval(tx, {
        type: ApprovalType.PROJECT_LAUNCH,
        title: `${decision.to === ProjectPhase.LAUNCH ? "Launch" : "Advance"}: ${project.name} to ${PHASE_LABEL[decision.to]}`,
        summary: `Move "${project.name}" from ${PHASE_LABEL[project.phase]} to ${PHASE_LABEL[decision.to]}.`,
        payload,
        reasoning: `${actor.name ?? "A team member"} asked to move "${project.name}" from ${PHASE_LABEL[project.phase]} to ${PHASE_LABEL[decision.to]}.${note ? ` Their note: ${note}` : ""} ${why}`,
        sources: [{ title: `${project.name} on the Development Map` }],
        risk: riskFor(project, decision.to),
        requestedByUserId: actor.id,
      });
      await tx.project.update({
        where: { id: project.id },
        data: { approvalRequestId: request.id },
      });
      return { status: "requested", to: decision.to, approvalId: request.id };
    }

    // Executives deciding a gated move must say why.
    const gated = isGatedMove(project, decision.to);
    if (decision.noteRequired && (note?.length ?? 0) < MIN_DECISION_NOTE) {
      throw new ForbiddenError(
        project.isTokenization
          ? "Record your decision, including the legal review, in a short note."
          : "Record why you are approving this step in a short note.",
      );
    }
    await moveProject(tx, project, decision.to, actor.id, { note: note ?? null, gated });
    return { status: "advanced", to: decision.to };
  });
}

async function moveProject(
  tx: DbClient,
  project: { id: string; name: string; phase: ProjectPhase; isTokenization: boolean },
  to: ProjectPhase,
  actorId: string,
  metadata: Record<string, unknown>,
) {
  await tx.project.update({
    where: { id: project.id },
    data: {
      phase: to,
      progress: to === ProjectPhase.LAUNCH ? 100 : 0,
      locked: lockedAfterMove(project),
      approvalRequestId: null,
    },
  });
  await recordAudit(tx, {
    actor: { type: "USER", userId: actorId },
    action: "project.advanced",
    entityType: "Project",
    entityId: project.id,
    before: { phase: project.phase },
    after: { phase: to },
    metadata,
  });
}

/**
 * Called by decideApproval() for PROJECT_LAUNCH requests, inside its transaction.
 * Approving applies the move it describes; rejecting clears the pending flag.
 */
export async function applyProjectDecision(
  tx: DbClient,
  request: { id: string; payload: unknown },
  decision: "APPROVE" | "REJECT",
  actorId: string,
  note: string | null,
) {
  const project = await tx.project.findFirst({ where: { approvalRequestId: request.id } });
  if (!project) return;
  const payload = request.payload as { from?: ProjectPhase; to?: ProjectPhase };
  if (decision === "REJECT") {
    await tx.project.update({ where: { id: project.id }, data: { approvalRequestId: null } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actorId },
      action: "project.advance_rejected",
      entityType: "Project",
      entityId: project.id,
      metadata: { approvalRequestId: request.id, note },
    });
    return;
  }
  if (!payload.to || payload.from !== project.phase) {
    const { ApprovalConflictError } = await import("@/server/approvals/service");
    throw new ApprovalConflictError(
      "The project moved since this was requested. Reject it instead.",
    );
  }
  await moveProject(tx, project, payload.to, actorId, {
    approvalRequestId: request.id,
    note,
    gated: true,
  });
}

// ----------------------------------------------------------- backlog & card --

export const ideaSchema = z.object({
  name: z.string().trim().min(3, "Name the idea.").max(80),
  description: z.string().trim().min(5, "Describe it in a sentence.").max(200),
});

export async function addIdea(actor: Actor, input: z.input<typeof ideaSchema>, client: Db = db) {
  authorize(actor, "roadmap.manage");
  const data = ideaSchema.parse(input);
  return client.$transaction(async (tx) => {
    const last = await tx.project.aggregate({ _max: { sortOrder: true } });
    const project = await tx.project.create({
      data: {
        name: data.name,
        description: data.description,
        phase: ProjectPhase.IDEA,
        onMap: false,
        ownerId: actor.id,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "project.idea_added",
      entityType: "Project",
      entityId: project.id,
      after: { name: project.name },
    });
    return project;
  });
}

export async function addToMap(actor: Actor, projectId: string, client: Db = db) {
  authorize(actor, "roadmap.manage");
  return client.$transaction(async (tx) => {
    const updated = await tx.project.updateMany({
      where: { id: projectId, onMap: false },
      data: { onMap: true, phase: ProjectPhase.IDEA, progress: 0 },
    });
    if (updated.count !== 1) throw new ForbiddenError("That idea is already on the map.");
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "project.added_to_map",
      entityType: "Project",
      entityId: projectId,
    });
  });
}

export const progressSchema = z.object({
  projectId: z.string().min(1),
  progress: z.coerce.number().int().min(0, "0 to 100.").max(100, "0 to 100."),
});

export async function setProgress(
  actor: Actor,
  input: z.input<typeof progressSchema>,
  client: Db = db,
) {
  authorize(actor, "roadmap.manage");
  const data = progressSchema.parse(input);
  return client.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id: data.projectId } });
    if (!before || !before.onMap) throw new ForbiddenError("That project is not on the map.");
    if (before.isTokenization && actor.role !== "EXECUTIVE")
      throw new ForbiddenError("Only executives update the tokenization platform.");
    await tx.project.update({ where: { id: before.id }, data: { progress: data.progress } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "project.progress_updated",
      entityType: "Project",
      entityId: before.id,
      before: { progress: before.progress },
      after: { progress: data.progress },
    });
  });
}
