import type * as React from "react";
import { AppFrame } from "@/components/shell/app-frame";
import { db } from "@/lib/db";
import { NAV_GROUPS } from "@/lib/navigation";
import { requireUser } from "@/server/auth/session";
import { can, ROLE_LABELS } from "@/server/authz/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unreadCount = await db.notification.count({ where: { userId: user.id, readAt: null } });

  // Navigation is filtered on the server; each page still re-checks its own permission.
  const allowedHrefs = NAV_GROUPS.flatMap((g) => g.items)
    .filter((item) => item.permissions.some((p) => can(user.role, p)))
    .map((item) => item.href);

  return (
    <AppFrame
      user={{ name: user.name, email: user.email, roleLabel: ROLE_LABELS[user.role] }}
      allowedHrefs={allowedHrefs}
      unreadCount={unreadCount}
    >
      {children}
    </AppFrame>
  );
}
