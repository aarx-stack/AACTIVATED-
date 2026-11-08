import {
  ArrowRight,
  BarChart3,
  CircleAlert,
  Landmark,
  Layers,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DeltaChip } from "@/components/command-center/kpi-card";
import { DeptSpendChart } from "@/components/finance/dept-spend-chart";
import {
  LimitForm,
  NewBudgetForm,
  RecordPurchaseButton,
  RecordSpendForm,
  SyncNowButton,
} from "@/components/finance/budget-forms";
import { RangeSelect } from "@/components/finance/range-select";
import { RevenueChart } from "@/components/finance/revenue-chart";
import { TransactionsTable } from "@/components/finance/transactions-table";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/server/authz/permissions";
import { cn, formatPercent, formatRelativeTime, formatUsd } from "@/lib/utils";
import { Meter } from "@/components/ui/meter";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/session";
import { getFinance, parseRange } from "@/server/queries/finance";

export const metadata: Metadata = { title: "Finance & Budget" };

const RANGE_LABEL = { 30: "previous 30 days", 90: "previous 90 days", 180: "previous 6 months" };

const KIND_LABEL: Record<string, string> = {
  AI_MODEL: "AI models",
  ADVERTISING: "Advertising",
  SOFTWARE: "Software",
  CONTRACTOR: "Contractors",
  OTHER: "Other",
};

const STATUS_PILL = {
  OK: { tone: "success", label: "On track" },
  WARNING: { tone: "warning", label: "Watch" },
  LOCKED: { tone: "danger", label: "Paused: approval needed" },
} as const;

function Kpi({
  label,
  value,
  icon: Icon,
  children,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-[var(--border-strong)] bg-info-soft shadow-glow-soft">
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <p className="-mt-2 text-[28px] leading-tight font-bold tracking-tight tabular-nums">
        {value}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {children}
      </div>
    </Card>
  );
}

function deltaFor(change: number | null, goodWhenUp = true) {
  if (change === null) return null;
  const trend = Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down";
  return {
    text: `${change > 0 ? "+" : ""}${formatPercent(change, 1)}`,
    trend,
    goodWhenUp,
  } as const;
}

/** Budget bar with a marker at the 75% approval point. */
function BudgetBar({
  ratio,
  threshold,
  label,
}: {
  ratio: number;
  threshold: number;
  label: string;
}) {
  const fill = ratio >= threshold ? "bg-danger" : ratio >= 0.6 ? "bg-warning" : "bar-fill";
  return (
    <div className="relative">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-muted"
      >
        <div
          className={cn("h-full rounded-pill", fill)}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
      <span
        aria-hidden
        className="absolute -top-1 h-[18px] w-0.5 rounded-pill bg-foreground/70"
        style={{ left: `calc(${threshold * 100}% - 1px)` }}
        title="Approval point"
      />
    </div>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requirePagePermission("finance.view");
  const range = parseRange((await searchParams).range);
  const data = await getFinance(range);
  const manage = can(user.role, "budget.manage");
  const { kpis, budgetTotals } = data;
  const usage = budgetTotals.limit > 0 ? budgetTotals.spent / budgetTotals.limit : 0;
  const budgetOptions = data.budgets.map((b) => ({ id: b.id, name: b.name }));
  const [creditDone, creditTotal] = await Promise.all([
    db.creditMilestone.count({ where: { status: "DONE" } }),
    db.creditMilestone.count(),
  ]);
  const departmentOptions = await db.department.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  const qb = data.quickbooks;
  const qbOk = qb?.status === "OPERATIONAL";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Finance & Budget"
        description="Track revenue, expenses, AI spend and budgets. When a budget reaches 75%, management is alerted and more spending in it needs approval."
        actions={<RangeSelect value={range} />}
      />

      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Revenue" value={formatUsd(kpis.revenue)} icon={BarChart3}>
          {deltaFor(kpis.revenueChange) && <DeltaChip delta={deltaFor(kpis.revenueChange)!} />}
          <span>vs. {RANGE_LABEL[range]}</span>
        </Kpi>
        <Kpi label="Total Expense" value={formatUsd(kpis.expense)} icon={Layers}>
          {deltaFor(kpis.expenseChange, false) && (
            <DeltaChip delta={deltaFor(kpis.expenseChange, false)!} />
          )}
          <span>vs. {RANGE_LABEL[range]}</span>
        </Kpi>
        <Kpi label="Net Profit" value={formatUsd(kpis.net)} icon={TrendingUp}>
          {deltaFor(kpis.netChange) && <DeltaChip delta={deltaFor(kpis.netChange)!} />}
          <span>vs. {RANGE_LABEL[range]}</span>
        </Kpi>
        <Kpi label="Budget Usage" value={formatPercent(usage)} icon={Wallet}>
          <span className="tabular-nums">
            {formatUsd(budgetTotals.spent)} of {formatUsd(budgetTotals.limit)} this month
          </span>
        </Kpi>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Revenue vs Expense</h2>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-pill bg-[var(--chart-2)]" aria-hidden /> Revenue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-pill bg-[var(--chart-1)]" aria-hidden /> Expense
              </span>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Running totals for the period.</p>
          <RevenueChart data={data.series} />
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold">AI Spend by Department</h2>
          <p className="-mt-2 text-xs text-muted-foreground">
            Model calls logged for each agent, grouped by its department.
          </p>
          {data.aiByDepartment.length > 0 ? (
            <DeptSpendChart data={data.aiByDepartment} />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No AI spend in this period.
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 p-5" data-testid="budgets">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Budget</h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              Total {formatUsd(budgetTotals.limit)} · Spent {formatUsd(budgetTotals.spent)} ·
              Remaining {formatUsd(Math.max(0, budgetTotals.limit - budgetTotals.spent))}
            </p>
          </div>
          {data.pausedBudgets > 0 && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-sm font-medium text-warning"
            >
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              Management approval required to continue spending in{" "}
              {data.pausedBudgets === 1 ? "one budget" : `${data.pausedBudgets} budgets`}.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {data.budgets.map((b) => {
              const pill = STATUS_PILL[b.state.status];
              return (
                <li key={b.id} className="flex flex-col gap-2.5 tile p-4" data-testid="budget-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {KIND_LABEL[b.kind]} · {b.department}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm tabular-nums">
                        <span className="font-semibold">{formatUsd(b.spentUsd)}</span>
                        <span className="text-muted-foreground"> / {formatUsd(b.limitUsd)}</span>
                      </span>
                      <span className="w-12 text-right text-lg font-bold tabular-nums">
                        {formatPercent(b.state.ratio)}
                      </span>
                    </div>
                  </div>
                  <BudgetBar
                    ratio={b.state.ratio}
                    threshold={b.threshold}
                    label={`${b.name}: ${formatPercent(b.state.ratio)} of budget used`}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge tone={pill.tone}>{pill.label}</Badge>
                    {b.state.locked ? (
                      <span>
                        Reached {formatPercent(b.threshold)} on{" "}
                        {b.alertSentAt?.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        }) ?? "this period"}
                        . No more spending until an executive approves.
                      </span>
                    ) : b.state.reachedThreshold ? (
                      <span>
                        Approved to continue: {formatUsd(b.state.headroomUsd)} left before it pauses
                        again.
                      </span>
                    ) : (
                      <span>
                        {formatUsd(b.state.headroomUsd)} until the {formatPercent(b.threshold)}{" "}
                        approval point.
                      </span>
                    )}
                    {b.pendingContinueId && (
                      <Link
                        href={`/approvals/${b.pendingContinueId}`}
                        className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        Review request <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    )}
                  </div>
                  {b.pendingLimitChange && (
                    <p className="text-xs text-muted-foreground" data-testid="pending-limit-change">
                      Limit change requested:{" "}
                      <Link
                        href={`/approvals/${b.pendingLimitChange.id}`}
                        className="text-primary hover:underline"
                      >
                        {b.pendingLimitChange.title.replace(/^Budget:\s*/, "")}
                      </Link>
                    </p>
                  )}
                  {b.pendingPurchases.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Waiting for approval:{" "}
                      {b.pendingPurchases.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link
                            href={`/approvals/${p.id}`}
                            className="text-primary hover:underline"
                          >
                            {p.title.replace(/^Spend:\s*/, "")}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                  {manage &&
                    b.toRecord.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-success-line bg-success-soft px-3 py-2 text-sm"
                      >
                        <span>
                          Approved purchase ready to record:{" "}
                          <span className="font-medium">{p.title.replace(/^Spend:\s*/, "")}</span>
                        </span>
                        <RecordPurchaseButton
                          approvalId={p.id}
                          label={`Record ${formatUsd(p.amountUsd)}`}
                        />
                      </div>
                    ))}
                </li>
              );
            })}
          </ul>
          {manage && data.budgets.length > 0 && (
            <details className="tile p-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer text-sm font-semibold">
                Record spend or change a limit
              </summary>
              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <RecordSpendForm budgets={budgetOptions} />
                <LimitForm budgets={budgetOptions} />
              </div>
            </details>
          )}
          {manage && (
            <details
              className="tile p-4 [&_summary::-webkit-details-marker]:hidden"
              open={data.budgets.length === 0}
            >
              <summary className="cursor-pointer text-sm font-semibold">New budget</summary>
              <div className="mt-4">
                <NewBudgetForm departments={departmentOptions} />
              </div>
            </details>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-3 p-5" data-testid="credit-builder-card">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Credit Builder</h2>
              <Badge tone="info">Division</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Building the company&apos;s credit and business profile: {creditDone} of {creditTotal}{" "}
              plan steps done.
            </p>
            <Meter
              value={creditDone}
              max={creditTotal || 1}
              label="Credit Builder plan progress"
              tone="primary"
            />
            <Button asChild variant="secondary" size="sm" className="self-start">
              <Link href="/finance/credit">Open Credit Builder</Link>
            </Button>
          </Card>

          <Card className="flex flex-col gap-4 p-5" data-testid="quickbooks">
            <h2 className="text-base font-semibold">QuickBooks Sync</h2>
            {qb ? (
              <div className="flex flex-wrap items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-pill border border-success-line bg-success-soft text-success">
                  <Landmark className="size-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">QuickBooks</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge tone={qbOk ? "success" : "danger"}>
                      {qbOk ? "Synced" : "Unavailable"}
                    </Badge>
                    {qb.mode === "MOCK" && <Badge tone="outline">Mock data</Badge>}
                    <span>
                      Last sync:{" "}
                      {qb.lastSyncAt ? (
                        <time dateTime={qb.lastSyncAt.toISOString()}>
                          {formatRelativeTime(qb.lastSyncAt)}
                        </time>
                      ) : (
                        "never"
                      )}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {qbOk
                      ? "Read-only: transactions come in from QuickBooks and nothing is written back."
                      : `${qb.lastError ?? "QuickBooks is not responding."} The figures below are from the last successful sync.`}
                  </p>
                </div>
                <SyncNowButton />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">QuickBooks is not set up.</p>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="tile p-3">
                <dt className="text-xs text-muted-foreground">Transactions synced</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {qb?.syncedTransactions ?? "—"}
                </dd>
              </div>
              <div className="tile p-3">
                <dt className="text-xs text-muted-foreground">Access</dt>
                <dd className="text-lg font-semibold">Read-only</dd>
              </div>
            </dl>
          </Card>
          <Card className="flex flex-col gap-3 p-5" data-testid="spend-rule">
            <h2 className="text-base font-semibold">How spending approval works</h2>
            <ol className="flex flex-col gap-2.5 text-sm">
              {[
                ["Below 75%", "Spend is recorded against its budget as usual."],
                [
                  "At 75%",
                  "Executives are alerted and spending in that budget pauses, including the agents' AI use.",
                ],
                [
                  "Approved",
                  "An executive approves more in the Approval Queue. Spending continues up to the approved amount.",
                ],
              ].map(([step, text], i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-pill border border-[var(--border-strong)] text-xs font-bold">
                    {i + 1}
                  </span>
                  <span>
                    <span className="font-semibold">{step}.</span>{" "}
                    <span className="text-muted-foreground">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <Link
              href="/approvals?type=SPEND"
              className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              {data.pendingSpendApprovals > 0
                ? `${data.pendingSpendApprovals} spend ${data.pendingSpendApprovals === 1 ? "request" : "requests"} waiting`
                : "Spend requests"}{" "}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Card>
        </div>
      </div>

      <Card className="p-5">
        <CardHeader className="mb-3 flex flex-row items-center justify-between gap-2 p-0">
          <CardTitle>Recent Transactions</CardTitle>
          <Link
            href="/finance/transactions"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            View all transactions <ArrowRight className="size-4" aria-hidden />
          </Link>
        </CardHeader>
        <TransactionsTable rows={data.recent} />
      </Card>
    </div>
  );
}
