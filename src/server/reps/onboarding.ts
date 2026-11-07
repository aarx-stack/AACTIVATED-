import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { type Actor, ForbiddenError } from "@/server/authz/permissions";
import { syncRepPod } from "./pods";

export const onboardingSchema = z.object({
  acceptContentRules: z.literal(true, { error: "Please accept the content and posting rules." }),
  acceptLeadPolicy: z.literal(true, { error: "Please accept the lead generation policy." }),
});

export function isRep(role: Role) {
  return role === Role.PREMIUM_REP || role === Role.FREE_REP;
}

/**
 * A new rep accepts the rules; their profile and AI pod are created from the
 * current best templates. Premium reps also get a GoHighLevel sub-account (mock).
 */
export async function completeOnboarding(
  actor: Actor,
  input: z.input<typeof onboardingSchema>,
  client: Db = db,
) {
  if (!isRep(actor.role)) throw new ForbiddenError("Onboarding is for reps.");
  if (actor.status === "SUSPENDED") throw new ForbiddenError("This account is suspended.");
  onboardingSchema.parse(input);

  return client.$transaction(async (tx) => {
    const now = new Date();
    const profile = await tx.repProfile.upsert({
      where: { userId: actor.id },
      create: {
        userId: actor.id,
        policiesAcceptedAt: now,
        ghlSubAccountId: actor.role === Role.PREMIUM_REP ? `mock-sub-${actor.id.slice(-8)}` : null,
      },
      update: { policiesAcceptedAt: now },
    });
    const pod = await syncRepPod(tx, actor.id, { type: "USER", userId: actor.id });
    await tx.user.update({ where: { id: actor.id }, data: { onboardedAt: now, status: "ACTIVE" } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "rep.onboarded",
      entityType: "User",
      entityId: actor.id,
      after: {
        policiesAcceptedAt: now,
        podAgents: pod.created,
        ghlSubAccountId: profile.ghlSubAccountId,
      },
    });
    return { profile, pod };
  });
}
