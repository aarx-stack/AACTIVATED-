import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RuleForm, RuleToggle } from "@/components/approvals/rule-controls";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { CHANNEL, RISK } from "@/lib/labels";
import { humanize } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";

export const metadata: Metadata = { title: "Compliance rules" };

export default async function ComplianceRulesPage() {
  const user = await requirePagePermission("approvals.view");
  const canManage = can(user.role, "compliance_rules.manage");
  const rules = await db.complianceRule.findMany({
    orderBy: [{ active: "desc" }, { type: "asc" }, { createdAt: "asc" }],
  });

  return (
    <>
      <Link
        href="/approvals"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Approval Queue
      </Link>
      <PageHeader
        eyebrow="Compliance"
        title="Content rules"
        description="Every agent draft is checked against these rules before it reaches the queue. High and critical findings need an executive decision."
      />

      {canManage && (
        <Card className="mb-4">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Add a rule</CardTitle>
            <CardDescription>
              Executives only. Changes are audited and apply to every check from now on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuleForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-col items-stretch">
          <CardTitle>Rules</CardTitle>
          <CardDescription>
            {rules.filter((r) => r.active).length} active. The seeded terms are placeholders:
            replace them with your real peptide names, branded stack names and blocklist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="rules-table">
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">{canManage ? "Status" : ""}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} className={r.active ? undefined : "opacity-60"}>
                  <TableCell>
                    <p className="font-mono text-sm">{r.pattern}</p>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  </TableCell>
                  <TableCell className="text-sm">{humanize(r.type)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.channels.length ? r.channels.map((c) => CHANNEL[c]).join(", ") : "All"}
                  </TableCell>
                  <TableCell>
                    <Badge tone={RISK[r.severity].tone}>{humanize(r.severity)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <RuleToggle id={r.id} active={r.active} label={r.pattern} />
                    ) : (
                      !r.active && <Badge tone="neutral">Disabled</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
