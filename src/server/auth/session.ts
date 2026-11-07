import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { authorize, can, type Permission } from "@/server/authz/permissions";
import { auth } from "./config";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof loadCurrentUser>>>;

async function loadCurrentUser() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      theme: true,
      title: true,
      image: true,
    },
  });
  if (!user || user.status === "SUSPENDED") return null;
  return user;
}

/** The signed-in user, read fresh from the database (role changes apply immediately). */
export const getCurrentUser = cache(loadCurrentUser);

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirects instead of throwing. */
export async function requirePagePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/forbidden");
  return user;
}

/** For server actions and route handlers: throws ForbiddenError / UnauthenticatedError. */
export async function requireActionPermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  authorize(user, permission);
  return user;
}

export function homePathFor(role: Role): string {
  if (role === "PREMIUM_REP" || role === "FREE_REP") return "/my-team";
  return "/command-center";
}
