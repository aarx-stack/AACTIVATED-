import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatRelativeTime, humanize } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { markAllNotificationsRead } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requirePagePermission("account.manage_own");
  const notifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You are all caught up."}
        actions={
          unread > 0 && (
            <form action={markAllNotificationsRead}>
              <Button variant="secondary" size="sm" type="submit">
                Mark all as read
              </Button>
            </form>
          )
        }
      />
      <Card>
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.readAt && (
                        <span className="size-2 rounded-pill bg-primary" aria-label="Unread" />
                      )}
                      <p className="font-medium">{n.title}</p>
                      <Badge tone="outline">{humanize(n.kind)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                    {n.href && (
                      <Link
                        href={n.href}
                        className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        Open
                      </Link>
                    )}
                  </div>
                  <time
                    className="shrink-0 text-xs text-subtle-foreground"
                    dateTime={n.createdAt.toISOString()}
                  >
                    {formatRelativeTime(n.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
