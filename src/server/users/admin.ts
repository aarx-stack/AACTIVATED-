/**
 * User administration. Every mutation:
 *  1. re-checks the policy on the server (never trusts the UI),
 *  2. writes the change and its AuditLog entry in one transaction.
 */
import { z } from "zod";
import { Role, UserStatus } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { canChangeRole, canChangeUserStatus } from "@/server/authz/policies";
import { syncRepPod } from "@/server/reps/pods";

export class NotFoundError extends Error {
  readonly status = 404;
}

export async function changeUserRole(
  actor: Actor,
  targetId: string,
  nextRole: Role,
  client: Db = db,
) {
  authorize(actor, "users.manage");
  return client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundError("User not found.");
    const decision = canChangeRole(actor, target, nextRole);
    if (!decision.ok) throw new ForbiddenError(decision.reason);

    const updated = await tx.user.update({ where: { id: targetId }, data: { role: nextRole } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "user.role_changed",
      entityType: "User",
      entityId: targetId,
      before: { role: target.role },
      after: { role: updated.role },
    });
    // An onboarded rep's AI pod follows their plan: upgrades add agents from the
    // current templates, downgrades pause the extras (history is kept).
    if (await tx.repPod.findUnique({ where: { repId: targetId } })) {
      await syncRepPod(tx, targetId, { type: "USER", userId: actor.id });
      if (nextRole === Role.PREMIUM_REP) {
        await tx.repProfile.updateMany({
          where: { userId: targetId, ghlSubAccountId: null },
          data: { ghlSubAccountId: `mock-sub-${targetId.slice(-8)}` },
        });
      }
    }
    return updated;
  });
}

export async function setUserStatus(
  actor: Actor,
  targetId: string,
  status: Extract<UserStatus, "ACTIVE" | "SUSPENDED">,
  client: Db = db,
) {
  authorize(actor, "users.manage");
  return client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundError("User not found.");
    const decision = canChangeUserStatus(actor, target);
    if (!decision.ok) throw new ForbiddenError(decision.reason);

    const updated = await tx.user.update({ where: { id: targetId }, data: { status } });
    // Suspension must take effect immediately: drop any database sessions.
    if (status === UserStatus.SUSPENDED)
      await tx.session.deleteMany({ where: { userId: targetId } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: status === UserStatus.SUSPENDED ? "user.suspended" : "user.reactivated",
      entityType: "User",
      entityId: targetId,
      before: { status: target.status },
      after: { status: updated.status },
    });
    return updated;
  });
}

export const inviteSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(Role),
});

export async function inviteUser(
  actor: Actor,
  input: z.input<typeof inviteSchema>,
  client: Db = db,
) {
  authorize(actor, "users.manage");
  const data = inviteSchema.parse(input);
  if (data.role === Role.EXECUTIVE && actor.role !== Role.EXECUTIVE) {
    throw new ForbiddenError("Only an executive can invite another executive.");
  }
  return client.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ForbiddenError("A user with this email already exists.");
    const user = await tx.user.create({
      data: { name: data.name, email: data.email, role: data.role, status: UserStatus.INVITED },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "user.invited",
      entityType: "User",
      entityId: user.id,
      after: { email: user.email, role: user.role },
    });
    return user;
  });
}
