import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { decideApproval } from "@/server/approvals/service";
import { ForbiddenError } from "@/server/authz/permissions";
import {
  addIdea,
  addToMap,
  advanceProject,
  getRoadmap,
  setProgress,
} from "@/server/roadmap/service";
import { createUser, db } from "./helpers";

afterAll(() => db.$disconnect());

async function project(
  overrides: Partial<{
    phase: "IDEA" | "BUILD" | "REVIEW" | "LAUNCH";
    locked: boolean;
    requiresExecutiveApproval: boolean;
    isTokenization: boolean;
  }> = {},
) {
  return db.project.create({
    data: {
      name: `Test project ${randomUUID().slice(0, 6)}`,
      description: "For tests",
      phase: "BUILD",
      progress: 40,
      ...overrides,
    },
  });
}

const actions = (id: string) =>
  db.auditLog
    .findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } })
    .then((r) => r.map((a) => a.action));

describe("Development & Tokenization Map", () => {
  it("staff move an ungated project; progress resets; the move is audited", async () => {
    const staff = await createUser(Role.STAFF);
    const p = await project();
    expect(await advanceProject(staff, { projectId: p.id })).toEqual({
      status: "advanced",
      to: "REVIEW",
    });
    const after = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.phase).toBe("REVIEW");
    expect(after.progress).toBe(0);
    expect(await actions(p.id)).toEqual(["project.advanced"]);
  });

  it("a gated launch goes to the Approval Queue, shows as pending, and approving applies it", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const p = await project({ phase: "REVIEW", requiresExecutiveApproval: true });

    const result = await advanceProject(staff, { projectId: p.id, note: "QA passed" });
    expect(result.status).toBe("requested");
    const request = await db.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalId! },
    });
    expect(request.type).toBe("PROJECT_LAUNCH");
    expect(request.requiredRole).toBe(Role.EXECUTIVE);
    expect(request.reasoning).toContain("QA passed");
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).phase).toBe("REVIEW");

    const roadmap = await getRoadmap(staff, { q: p.name });
    expect(roadmap.projects[0]?.pendingApproval).toBe(true);
    await expect(advanceProject(staff, { projectId: p.id })).rejects.toThrow(/already waiting/);

    // A note is required to approve a project move.
    await expect(decideApproval(exec, request.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await decideApproval(exec, request.id, {
      decision: "APPROVE",
      note: "Launch checklist signed off",
    });
    const after = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.phase).toBe("LAUNCH");
    expect(after.approvalRequestId).toBeNull();
    expect(await actions(p.id)).toContain("project.advanced");
  });

  it("rejecting clears the pending step without moving the project", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const p = await project({ locked: true });
    const result = await advanceProject(staff, { projectId: p.id });
    await decideApproval(exec, result.approvalId!, { decision: "REJECT", note: "Not yet" });
    const after = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.phase).toBe("BUILD");
    expect(after.approvalRequestId).toBeNull();
    expect(await actions(p.id)).toContain("project.advance_rejected");
  });

  it("the tokenization platform needs an executive note at every step and stays locked", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const p = await project({
      isTokenization: true,
      locked: true,
      requiresExecutiveApproval: true,
    });

    expect((await advanceProject(staff, { projectId: p.id })).status).toBe("requested");
    await db.project.update({ where: { id: p.id }, data: { approvalRequestId: null } });

    await expect(advanceProject(exec, { projectId: p.id })).rejects.toThrow(/legal review/);
    expect(
      await advanceProject(exec, { projectId: p.id, note: "Counsel reviewed the scope document" }),
    ).toEqual({ status: "advanced", to: "REVIEW" });
    const after = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.locked).toBe(true);
    // Launch still needs another decision.
    expect((await advanceProject(staff, { projectId: p.id })).status).toBe("requested");

    // Only executives update its progress.
    await expect(setProgress(staff, { projectId: p.id, progress: 50 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("reps cannot see the map; admins can see but not move", async () => {
    const rep = await createUser(Role.PREMIUM_REP);
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const p = await project();
    await expect(getRoadmap(rep)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(advanceProject(admin, { projectId: p.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ideas wait in the backlog until someone adds them to the map", async () => {
    const staff = await createUser(Role.STAFF);
    const idea = await addIdea(staff, { name: "Test idea board", description: "A backlog item" });
    let roadmap = await getRoadmap(staff, { q: "Test idea board" });
    expect(roadmap.backlog.map((b) => b.id)).toContain(idea.id);
    expect(roadmap.projects).toHaveLength(0);
    await expect(advanceProject(staff, { projectId: idea.id })).rejects.toThrow(/not on the map/);

    await addToMap(staff, idea.id);
    roadmap = await getRoadmap(staff, { q: "Test idea board" });
    expect(roadmap.projects.map((p) => p.id)).toEqual([idea.id]);
    await expect(addToMap(staff, idea.id)).rejects.toThrow(/already on the map/);
    expect(await actions(idea.id)).toEqual(["project.idea_added", "project.added_to_map"]);
  });
});
