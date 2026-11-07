import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auditLabel } from "@/lib/labels";
import { formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { getAuditLog } from "@/server/queries/admin";

export const metadata: Metadata = { title: "Audit Log" };

export default async function AuditLogPage() {
  await requirePagePermission("audit_log.view");
  const audit = await getAuditLog(150);
  return (
    <>
      <Link
        href="/admin"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Admin & Access Control
      </Link>
      <PageHeader
        title="Audit Log"
        description="Append-only. The database rejects any edit or deletion of these records."
      />
      <Card className="p-5">
        <Table data-testid="audit-log">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  <time dateTime={a.createdAt.toISOString()}>
                    {formatRelativeTime(a.createdAt)}
                  </time>
                </TableCell>
                <TableCell className="text-sm">
                  {a.actorType === "USER"
                    ? (a.actorUser?.name ?? a.actorUser?.email)
                    : a.actorType === "AGENT"
                      ? "Agent"
                      : "System"}
                </TableCell>
                <TableCell className="text-sm">
                  {auditLabel(a.action)}
                  <span className="block font-mono text-[11px] text-subtle-foreground">
                    {a.action}
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-md truncate text-xs text-muted-foreground md:table-cell">
                  {a.entityType}
                  {a.before !== null && a.after !== null && (
                    <span className="ml-2 font-mono">
                      {JSON.stringify(a.before)} → {JSON.stringify(a.after)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
