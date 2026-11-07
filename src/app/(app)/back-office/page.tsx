import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Database,
  Download,
} from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { GrowthChart } from "@/components/reps/growth-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatPercent, formatUsd } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { getBackOffice } from "@/server/queries/reps";

export const metadata: Metadata = { title: "Back Office" };

const STATUS = {
  PRESENTER: { label: "Presenter", detail: "Qualified · Active · Earning commissions" },
  CANDIDATE: { label: "Presenter Candidate", detail: "Working toward Presenter certification" },
  NONE: { label: "Representative", detail: "Active · Building your business" },
} as const;

function Tile({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  note: React.ReactNode;
}) {
  return (
    <Card className="flex items-start gap-4 p-5">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-control border border-[var(--border-strong)] bg-info-soft shadow-glow-soft">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[28px] leading-tight font-bold tabular-nums">{value}</p>
        <div className="mt-1 text-xs text-muted-foreground">{note}</div>
      </div>
    </Card>
  );
}

export default async function BackOfficePage() {
  const user = await requirePagePermission("back_office.view_own");
  const data = await getBackOffice(user.id);
  const status = STATUS[data.profile?.presenterStatus ?? "NONE"];
  const { progress, totals } = data;
  const change =
    totals.lastMonth > 0 ? (totals.thisMonth - totals.lastMonth) / totals.lastMonth : null;
  const earningsReq = progress.requirements.find((r) => r.label.includes("Earnings"));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Back Office — Earnings"
        description="Your representative back office to track earnings, team growth and payouts. Figures are records, not promises of future income."
      />

      <section aria-label="Earnings" className="grid gap-4 md:grid-cols-3">
        <Tile
          icon={CalendarDays}
          label="This Month"
          value={formatUsd(totals.thisMonth)}
          note={
            change === null ? (
              "First month on record"
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-medium",
                  change >= 0 ? "text-success" : "text-warning",
                )}
              >
                {change >= 0 ? (
                  <ArrowUpRight className="size-3.5" aria-hidden />
                ) : (
                  <ArrowDownRight className="size-3.5" aria-hidden />
                )}
                {change >= 0 ? "+" : ""}
                {formatPercent(change, 1)} vs. last month
              </span>
            )
          }
        />
        <Tile
          icon={Clock3}
          label="Pending"
          value={formatUsd(totals.pending)}
          note="Awaiting payout (current cycle)"
        />
        <Tile
          icon={Database}
          label="Lifetime"
          value={formatUsd(totals.lifetime)}
          note="Everything recorded since you joined"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card className="p-5" data-testid="plan-progress">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Commission Plan Progress</h2>
            <span className="text-xs text-muted-foreground">
              Placeholder plan until the official plan is loaded
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Current rank:{" "}
            <span className="font-semibold text-foreground">{progress.current.name}</span>
            {progress.next ? ` · next: ${progress.next.name}` : " · top rank reached"}
          </p>
          <div className="mt-4 flex items-center gap-4">
            <Meter
              value={progress.overall}
              max={1}
              label="Progress to the next rank"
              tone="primary"
              className="h-3.5 flex-1"
            />
            <span className="text-xl font-bold tabular-nums">
              {formatPercent(progress.overall)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
            {earningsReq && (
              <span>
                <span className="font-semibold">{formatUsd(earningsReq.current)}</span> of{" "}
                {formatUsd(earningsReq.target)} this month
              </span>
            )}
            {progress.next && (
              <span className="text-muted-foreground">
                {progress.requirements.filter((r) => !r.met).length} requirement(s) left for{" "}
                {progress.next.name}
              </span>
            )}
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {progress.requirements.map((r) => (
              <li key={r.label}>
                <Badge tone={r.met ? "success" : "neutral"}>
                  {r.label}:{" "}
                  {r.label.includes("Earnings")
                    ? formatUsd(r.current)
                    : r.label.includes("certification")
                      ? r.met
                        ? "done"
                        : "not yet"
                      : `${r.current}/${r.target}`}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col items-center justify-center gap-3 p-5 text-center">
          <h2 className="self-start text-lg font-semibold">Representative Status</h2>
          <span
            className="rounded-pill fill-primary px-10 py-3 text-xl font-bold tracking-wide"
            data-testid="presenter-status"
          >
            {status.label}
          </span>
          <p className="text-xs text-muted-foreground">{status.detail}</p>
        </Card>
      </div>

      <Card className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div>
          <h2 className="text-lg font-semibold">Team Growth</h2>
          <p className="text-xs text-muted-foreground">Total active team members over time.</p>
          <GrowthChart data={data.growth} />
        </div>
        <dl className="flex flex-col justify-center gap-4 border-border lg:border-l lg:pl-5">
          <div>
            <dt className="text-sm">Total Team Members</dt>
            <dd className="text-[28px] leading-tight font-bold tabular-nums">{data.teamSize}</dd>
          </div>
          <div>
            <dt className="text-sm">New Members (30D)</dt>
            <dd className="text-[28px] leading-tight font-bold tabular-nums">
              {data.newMembers30d}
            </dd>
          </div>
          {data.team.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {data.team.map((t, i) => (
                <li key={i}>
                  <Badge tone="outline">{t.name}</Badge>
                </li>
              ))}
            </ul>
          )}
        </dl>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Payout History</h2>
            <p className="text-xs text-muted-foreground">Your commission payout records.</p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <a href="/back-office/payouts.csv" download>
              <Download aria-hidden /> Export CSV
            </a>
          </Button>
        </div>
        {data.payouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payouts yet.</p>
        ) : (
          <Table data-testid="payouts">
            <TableHeader>
              <TableRow>
                <TableHead>Payout date</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payouts.map((p) => {
                const period = new Date(p.paidAt.getFullYear(), p.paidAt.getMonth() - 1, 1);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-semibold">
                      {p.paidAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell>
                      {period.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {formatUsd(p.amountUsd.toNumber())}
                    </TableCell>
                    <TableCell>
                      <Badge tone="success">Paid</Badge>
                    </TableCell>
                    <TableCell>{p.method}</TableCell>
                    <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
