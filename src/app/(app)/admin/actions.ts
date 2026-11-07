"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit/audit";
import { requireActionPermission } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz/permissions";
import { getSystemHealth } from "@/server/health/health";
import { changeUserRole, inviteUser, NotFoundError, setUserStatus } from "@/server/users/admin";
import { db } from "@/lib/db";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function toResult(error: unknown): ActionResult {
  if (error instanceof ForbiddenError || error instanceof NotFoundError)
    return { ok: false, error: error.message };
  if (error instanceof z.ZodError)
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  console.error("[admin]", error);
  return { ok: false, error: "Something went wrong. Nothing was changed." };
}

export async function changeRoleAction(userId: string, role: Role): Promise<ActionResult> {
  try {
    const actor = await requireActionPermission("users.manage");
    await changeUserRole(actor, z.string().min(1).parse(userId), z.enum(Role).parse(role));
    revalidatePath("/admin");
    return { ok: true, message: "Role updated." };
  } catch (error) {
    return toResult(error);
  }
}

export async function setStatusAction(
  userId: string,
  status: "ACTIVE" | "SUSPENDED",
): Promise<ActionResult> {
  try {
    const actor = await requireActionPermission("users.manage");
    await setUserStatus(
      actor,
      z.string().min(1).parse(userId),
      z.enum(["ACTIVE", "SUSPENDED"]).parse(status),
    );
    revalidatePath("/admin");
    return { ok: true, message: status === "SUSPENDED" ? "User suspended." : "User reactivated." };
  } catch (error) {
    return toResult(error);
  }
}

export async function inviteUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const actor = await requireActionPermission("users.manage");
    const user = await inviteUser(actor, {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? "") as Role,
    });
    revalidatePath("/admin");
    return { ok: true, message: `Invited ${user.email}. They can now request a sign-in link.` };
  } catch (error) {
    return toResult(error);
  }
}

export async function runHealthCheckAction(): Promise<ActionResult> {
  try {
    const actor = await requireActionPermission("system_status.view");
    const health = await getSystemHealth({ persist: true });
    await recordAudit(db, {
      actor: { type: "USER", userId: actor.id },
      action: "system.health_checked",
      entityType: "System",
      metadata: { status: health.status },
    });
    revalidatePath("/admin");
    return { ok: true, message: `System is ${health.status.toLowerCase()}.` };
  } catch (error) {
    return toResult(error);
  }
}
