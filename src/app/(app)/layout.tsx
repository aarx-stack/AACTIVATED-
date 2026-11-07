import type * as React from "react";
import { AppFrame } from "@/components/shell/app-frame";
import { AgentKind, ApprovalStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { NAV_ITEMS } from "@/lib/navigation";
import { requireUser } from "@/server/auth/session";
import { can, ROLE_LABELS } from "@/server/authz/permissions";
import { approvalVisibilityWhere } from "@/server/queries/approvals";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const canApprove = can(user.role, "approvals.view");
  const [unreadCount, pendingApprovals, brain] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    canApprove
      ? db.approvalRequest.count({
          where: { AND: [{ status: ApprovalStatus.PENDING }, approvalVisibilityWhere(user.role)] },
        })
      : Promise.resolve(0),
    db.agent.findFirst({ where: { kind: AgentKind.BRAIN }, select: { status: true } }),
  ]);

  // Navigation is filtered on the server; each page still re-checks its own permission.
  const allowedHrefs = NAV_ITEMS.filter((item) =>
    item.permissions.some((p) => can(user.role, p)),
  ).map((item) => item.href);
  const online = brain?.status === "ACTIVE" || brain?.status === "IDLE";

  return (
    <AppFrame
      user={{ name: user.name, email: user.email, roleLabel: ROLE_LABELS[user.role] }}
      allowedHrefs={allowedHrefs}
      badges={{ "/approvals": pendingApprovals }}
      unreadCount={unreadCount}
      brain={{ online, label: online ? "AI Brain Online" : "AI Brain Paused" }}
    >
      {children}
    </AppFrame>
  );
}
