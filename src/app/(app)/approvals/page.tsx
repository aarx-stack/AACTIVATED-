import { ChevronRight, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { APPROVAL_STATUS, APPROVAL_TYPE, CHANNEL, OUTCOME, RISK } from "@/lib/labels";
import { cn, formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { listApprovals, type ApprovalTab } from "@/server/queries/approvals";

export const metadata: Metadata = { title: "Approval Queue" };

const TABS: { key: ApprovalTab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("approvals.view");
  const { tab: rawTab } = await searchParams;
  const tab: ApprovalTab = TABS.some((t) => t.key === rawTab) ? (rawTab as ApprovalTab) : "pending";
  const { items, counts } = await listApprovals(user.role, tab);

  return (
    <>
      <PageHeader
        eyebrow="Brain"
        title="Approval & Compliance Queue"
        description="Every post, email, message and spend request waits here for a human. Reasoning and sources are shown before any decision."
        actions={
          <Button asChild variant="secondary">
            <Link href="/approvals/rules">
              <ShieldCheck aria-hidden /> Compliance rules
            </Link>
          </Button>
        }
      />

      <nav
        aria-label="Filter approvals"
        className="mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-control border border-border bg-surface-muted p-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/approvals?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              tab === t.key
                ? "bg-surface-solid text-foreground shadow-glow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="rounded-pill bg-neutral-soft px-1.5 text-xs tabular-nums">
              {counts[t.key]}
            </span>
          </Link>
        ))}
      </nav>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {tab === "pending" ? "Nothing is waiting for a decision." : "No requests here yet."}
            </p>
          ) : (
            <ul
              className="divide-y divide-border"
              aria-label="Approval requests"
              data-testid="approval-list"
            >
              {items.map((a) => {
                const outcome = a.complianceChecks[0]?.outcome;
                const status = APPROVAL_STATUS[a.status];
                const needsExec = a.status === "PENDING" && a.requiredRole === "EXECUTIVE";
                const canDecideHere =
                  a.status === "PENDING" &&
                  (!needsExec || can(user.role, "approvals.decide_restricted"));
                return (
                  <li key={a.id}>
                    <Link
                      href={`/approvals/${a.id}`}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{a.title}</p>
                          {needsExec && <Badge tone="warning">Executive decision</Badge>}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {APPROVAL_TYPE[a.type]}
                          {a.contentItem && ` · ${CHANNEL[a.contentItem.channel]}`}
                          {a.requestedByAgent &&
                            ` · from ${a.requestedByAgent.name} (${a.requestedByAgent.title})`}
                          {" · "}
                          {formatRelativeTime(a.createdAt)}
                          {a.decidedBy && ` · decided by ${a.decidedBy.name}`}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge tone={RISK[a.risk].tone}>{RISK[a.risk].label}</Badge>
                          {outcome && (
                            <Badge tone={OUTCOME[outcome].tone}>{OUTCOME[outcome].label}</Badge>
                          )}
                          {a.status !== "PENDING" && (
                            <Badge tone={status.tone}>{status.label}</Badge>
                          )}
                          {a.revision > 1 && <Badge tone="outline">Revision {a.revision}</Badge>}
                        </div>
                      </div>
                      <span className="hidden text-sm text-primary sm:block">
                        {canDecideHere ? "Review" : "View"}
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-subtle-foreground"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
