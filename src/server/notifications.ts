import { NotificationKind, Role } from "@/generated/prisma/enums";
import type { DbClient } from "@/lib/db";

/** In-app notification to everyone who can decide a request at this level. */
export async function notifyApprovers(
  client: DbClient,
  requiredRole: Role,
  notification: { title: string; body: string; href: string; kind?: NotificationKind },
) {
  const roles = requiredRole === Role.EXECUTIVE ? [Role.EXECUTIVE] : [Role.EXECUTIVE, Role.STAFF];
  const approvers = await client.user.findMany({
    where: { role: { in: roles }, status: "ACTIVE" },
    select: { id: true },
  });
  if (approvers.length === 0) return 0;
  await client.notification.createMany({
    data: approvers.map((u) => ({
      userId: u.id,
      kind: notification.kind ?? NotificationKind.APPROVAL_REQUESTED,
      title: notification.title,
      body: notification.body,
      href: notification.href,
    })),
  });
  return approvers.length;
}

export async function notifyUser(
  client: DbClient,
  userId: string | null | undefined,
  notification: { title: string; body: string; href?: string; kind: NotificationKind },
) {
  if (!userId) return;
  await client.notification.create({ data: { userId, ...notification } });
}
