import { Award, CheckCircle2, Circle, Clock, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { KpiCard } from "@/components/command-center/kpi-card";
import { GrowthChart } from "@/components/reps/growth-chart";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercent, formatUsd, humanize } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { getBackOffice } from "@/server/queries/reps";

export const metadata: Metadata = { title: "Back Office" };

const PRESENTER = {
  PRESENTER: { label: "Presenter", tone: "success" },
  CANDIDATE: { label: "Presenter candidate", tone: "info" },
  NONE: { label: "Not yet a Presenter", tone: "neutral" },
} as const;

export default async function BackOfficePage() {
  const user = await requirePagePermission("back_office.view_own");
  const data = await getBackOffice(user.id);
  const presenter = PRESENTER[data.profile?.presenterStatus ?? "NONE"];
  const { progress } = data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Rep"
        title="Back Office"
        description="Your earnings, plan progress, team and payouts. Earnings shown are records, not promises of future income."
        actions={
          <Badge tone={presenter.tone} data-testid="presenter-status">
            <Award className="size-3" aria-hidden /> {presenter.label}
          </Badge>
        }
      />

      <section aria-label="Earnings" className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="This month"
          icon={Wallet}
          value={formatUsd(data.totals.thisMonth)}
          hint="All earnings recorded for this month"
        />
        <KpiCard
          label="Pending"
          icon={Clock}
          value={formatUsd(data.totals.pending)}
          hint="Recorded, not yet paid out"
        />
        <KpiCard
          label="Lifetime"
          icon={Award}
          value={formatUsd(data.totals.lifetime)}
          hint="Everything recorded since you joined"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-testid="plan-progress">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Commission plan</CardTitle>
            <CardDescription>
              Current rank <strong className="text-foreground">{progress.current.name}</strong>
              {progress.next ? ` · next: ${progress.next.name}` : " · top rank"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {progress.next ? (
              <>
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>Progress to {progress.next.name}</span>
                    <span className="tabular-nums">{formatPercent(progress.overall)}</span>
                  </div>
                  <Meter
                    value={progress.overall}
                    max={1}
                    label={`Progress to ${progress.next.name}`}
                    tone="primary"
                  />
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  {progress.requirements.map((r) => (
                    <li key={r.label} className="flex items-center gap-2">
                      {r.met ? (
                        <CheckCircle2 className="size-4 text-success" aria-label="Met" />
                      ) : (
                        <Circle
                          className="size-4 text-subtle-foreground"
                          aria-label="Not met yet"
                        />
                      )}
                      <span className="flex-1">{r.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {r.label.includes("Earnings")
                          ? `${formatUsd(r.current)} / ${formatUsd(r.target)}`
                          : r.label.includes("certification")
                            ? r.met
                              ? "Done"
                              : "Not yet"
                            : `${r.current} / ${r.target}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                You have reached the top rank in the plan.
              </p>
            )}
            <p className="text-xs text-subtle-foreground">
              Plan thresholds are placeholders until the official plan is loaded.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Team growth and earnings</CardTitle>
            <CardDescription>
              {data.teamSize} active team member{data.teamSize === 1 ? "" : "s"}. Bars: earnings per
              month. Line: team size.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GrowthChart data={data.growth} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Payout history</CardTitle>
          </CardHeader>
          <CardContent>
            {data.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payouts yet.</p>
            ) : (
              <Table data-testid="payouts">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">
                        {p.paidAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.method} · <span className="font-mono text-xs">{p.reference}</span>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatUsd(p.amountUsd.toNumber())}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Recent earnings</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentEarnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No earnings recorded yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {data.recentEarnings.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{e.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.period.toLocaleDateString("en-US", { month: "long", year: "numeric" })} ·{" "}
                        {humanize(e.kind)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={e.status === "PAID" ? "success" : "info"}>
                        {humanize(e.status)}
                      </Badge>
                      <span className="font-medium tabular-nums">
                        {formatUsd(e.amountUsd.toNumber())}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.team.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-semibold">Your team</h3>
                <ul className="flex flex-wrap gap-2">
                  {data.team.map((t, i) => (
                    <li key={i}>
                      <Badge tone="outline">
                        {t.name} · {t.role === "PREMIUM_REP" ? "Premium" : "Free"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
