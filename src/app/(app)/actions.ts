"use server";

import { z } from "zod";
import { ThemePreference } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { signOut } from "@/server/auth/config";
import { getCurrentUser } from "@/server/auth/session";

export async function saveThemePreference(theme: ThemePreference) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const };
  const parsed = z.enum(ThemePreference).safeParse(theme);
  if (!parsed.success) return { ok: false as const };
  await db.user.update({ where: { id: user.id }, data: { theme: parsed.data } });
  return { ok: true as const };
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
