import { CircleAlert, CircleCheck, CircleX, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalPanel, COMPLIANCE_PILL } from "@/components/approvals/approval-panel";
import { ApprovalFilters } from "@/components/approvals/filters";
import { ApprovalTypeIcon } from "@/components/approvals/type-icon";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApprovalType, RiskLevel } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { APPROVAL_STATUS, APPROVAL_TYPE, CHANNEL, RISK } from "@/lib/labels";
import { cn, formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { getApprovalDetail, listApprovals, type ApprovalTab } from "@/server/queries/approvals";

export const metadata: Metadata = { title: "Approval & Compliance Queue" };

const TABS: ApprovalTab[] = ["pending", "approved", "rejected", "all"];
const TAB_LABEL: Record<ApprovalTab, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  all: "All",
};

function reviewTime(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    type?: string;
    risk?: string;
    selected?: string;
  }>;
}) {
  const user = await requirePagePermission("approvals.view");
  const params = await searchParams;
  const tab: ApprovalTab = TABS.includes(params.tab as ApprovalTab)
    ? (params.tab as ApprovalTab)
    : "pending";
  const type = Object.values(ApprovalType).includes(params.type as ApprovalType)
    ? (params.type as ApprovalType)
    : undefined;
  const risk = Object.values(RiskLevel).includes(params.risk as RiskLevel)
    ? (params.risk as RiskLevel)
    : undefined;

  const [{ items, counts, stats }, complianceAgent] = await Promise.all([
    listApprovals(user.role, { tab, q: params.q, type, risk }),
    db.agent.findUnique({ where: { slug: "compliance-officer" }, select: { status: true } }),
  ]);
  const selectedId = items.some((i) => i.id === params.selected) ? params.selected! : items[0]?.id;
  const detail = selectedId ? await getApprovalDetail(user.role, selectedId) : null;
  const complianceOnline =
    complianceAgent?.status === "ACTIVE" || complianceAgent?.status === "IDLE";

  const link = (id: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "selected") p.set(k, v);
    p.set("selected", id);
    return `/approvals?${p.toString()}`;
  };

  const kpis = [
    {
      label: "Pending Review",
      value: counts.pending,
      href: "/approvals?tab=pending",
      active: tab === "pending",
    },
    {
      label: "Approved (7d)",
      value: stats.approved7d,
      href: "/approvals?tab=approved",
      active: tab === "approved",
    },
    {
      label: "Rejected (7d)",
      value: stats.rejected7d,
      href: "/approvals?tab=rejected",
      active: tab === "rejected",
    },
    {
      label: "Avg. Review Time",
      value: reviewTime(stats.avgReviewMinutes),
      href: undefined,
      active: false,
    },
  ];

  return (
    <>
      <PageHeader
        title="Approval & Compliance Queue"
        description="Review AI-generated content, campaigns and spend requests for policy, brand and regulatory compliance. Nothing leaves the company without a human decision."
        actions={
          <>
            <span className="glass flex items-center gap-2 rounded-pill px-4 py-2 text-xs font-semibold">
              <span
                className={cn(
                  "size-2 rounded-pill",
                  complianceOnline ? "bg-success" : "bg-warning",
                )}
                aria-hidden
              />
              AI Compliance Agent:{" "}
              <span className={complianceOnline ? "text-success" : "text-warning"}>
                {complianceOnline ? "Online" : "Paused"}
              </span>
            </span>
            {can(user.role, "budget.request_change") && (
              <Button asChild variant="secondary">
                <Link href="/budgets">Budgets</Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link href="/approvals/rules">
                <ShieldCheck aria-hidden /> Compliance rules
              </Link>
            </Button>
          </>
        }
      />

      <section
        aria-label="Queue metrics"
        className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:max-w-4xl"
      >
        {kpis.map((k) => {
          const body = (
            <>
              <p className="text-sm font-medium">{k.label}</p>
              <p className="mt-1 text-[28px] leading-tight font-bold text-cyan tabular-nums">
                {k.value}
              </p>
            </>
          );
          return k.href ? (
            <Link
              key={k.label}
              href={k.href}
              aria-current={k.active ? "page" : undefined}
              className={cn(
                "glass block p-4 transition-shadow hover:shadow-glow",
                k.active && "border-[var(--border-strong)] shadow-glow",
              )}
            >
              {body}
            </Link>
          ) : (
            <Card key={k.label} className="p-4">
              {body}
            </Card>
          );
        })}
      </section>

      <div className="mb-5">
        <ApprovalFilters />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <section aria-label={`${TAB_LABEL[tab]} items`}>
          <h2 className="mb-3 text-lg font-semibold">
            {TAB_LABEL[tab]} Items ({items.length})
          </h2>
          {items.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              {tab === "pending" ? "Nothing is waiting for a decision." : "No requests match."}
            </Card>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="approval-list">
              {items.map((a) => {
                const outcome = a.complianceChecks[0]?.outcome;
                const selected = a.id === selectedId;
                const owner =
                  a.requestedByAgent?.department?.name ??
                  a.requestedByAgent?.title ??
                  a.requestedByUser?.name ??
                  "Team";
                return (
                  <li key={a.id}>
                    <Link
                      href={link(a.id)}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "glass grid gap-4 p-4 transition-shadow hover:shadow-glow md:grid-cols-[minmax(0,1fr)_236px]",
                        selected && "border-[var(--border-strong)] shadow-glow",
                      )}
                    >
                      <div className="flex min-w-0 gap-3">
                        <ApprovalTypeIcon type={a.type} />
                        <div className="min-w-0">
                          <p className="font-semibold">{a.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.contentItem ? CHANNEL[a.contentItem.channel] : APPROVAL_TYPE[a.type]}
                            {a.requestedByAgent ? " · AI-generated" : " · Human request"}
                          </p>
                          <p className="mt-1.5 line-clamp-2 text-sm text-foreground/85">
                            {a.summary}
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                            <span className="tile rounded-pill px-2.5 py-1">
                              Type: {APPROVAL_TYPE[a.type]}
                            </span>
                            <span className="tile rounded-pill px-2.5 py-1">Owner: {owner}</span>
                            <span className="tile rounded-pill px-2.5 py-1">
                              Requested {formatRelativeTime(a.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] content-start gap-x-3 gap-y-1 border-border text-xs md:border-l md:pl-4">
                        <p className="font-medium">Compliance Check</p>
                        <p className="font-medium">Risk</p>
                        {outcome ? (
                          <Badge
                            tone={COMPLIANCE_PILL[outcome].tone}
                            className="justify-self-start"
                          >
                            {(() => {
                              const OutcomeIcon =
                                outcome === "PASS"
                                  ? CircleCheck
                                  : outcome === "WARN"
                                    ? CircleAlert
                                    : CircleX;
                              return <OutcomeIcon className="size-3" aria-hidden />;
                            })()}
                            {COMPLIANCE_PILL[outcome].label}
                          </Badge>
                        ) : (
                          <Badge tone="outline" className="justify-self-start">
                            Not applicable
                          </Badge>
                        )}
                        <Badge tone={RISK[a.risk].tone} className="justify-self-start">
                          {RISK[a.risk].label.replace(" risk", "")}
                        </Badge>
                        {a.status === "PENDING" && a.requiredRole === "EXECUTIVE" && (
                          <Badge tone="warning" className="col-span-2 mt-1 justify-self-start">
                            Executive decision
                          </Badge>
                        )}
                        {a.status !== "PENDING" && (
                          <Badge
                            tone={APPROVAL_STATUS[a.status].tone}
                            className="col-span-2 mt-1 justify-self-start"
                          >
                            {APPROVAL_STATUS[a.status].label}
                            {a.decidedBy ? ` by ${a.decidedBy.name}` : ""}
                          </Badge>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside aria-label="Selected request" className="xl:sticky xl:top-4 xl:self-start">
          {detail ? (
            <ApprovalPanel detail={detail} viewer={user} />
          ) : (
            <Card className="p-6 text-sm text-muted-foreground">Select an item to review it.</Card>
          )}
        </aside>
      </div>
    </>
  );
}
