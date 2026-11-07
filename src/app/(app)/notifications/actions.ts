"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActionPermission } from "@/server/auth/session";

export async function markAllNotificationsRead() {
  const user = await requireActionPermission("account.manage_own");
  await db.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/", "layout");
}
