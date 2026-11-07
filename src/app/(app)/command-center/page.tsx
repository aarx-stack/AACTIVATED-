import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  FileEdit,
  GitBranch,
  ListChecks,
  Lock,
  type LucideIcon,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AskBrain } from "@/components/command-center/ask-brain";
import { KpiCard } from "@/components/command-center/kpi-card";
import { SpendChart } from "@/components/command-center/spend-chart";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { StatusDot } from "@/components/ui/status-dot";
import type { ActivityKind } from "@/generated/prisma/enums";
import { AGENT_STATUS } from "@/lib/status";
import { cn, formatPercent, formatRelativeTime, formatUsd } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { getCommandCenterData } from "@/server/queries/command-center";
import type { HealthBand } from "@/server/queries/department-health";

export const metadata: Metadata = { title: "Command Center" };

const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  PLANNED: BrainCircuit,
  DELEGATED: GitBranch,
  STARTED: Activity,
  DRAFTED: FileEdit,
  COMPLIANCE_CHECKED: ShieldCheck,
  SUBMITTED_FOR_APPROVAL: Send,
  COMPLETED: CheckCircle2,
  HANDOFF: GitBranch,
  REPORTED: ListChecks,
  FLAGGED: AlertTriangle,
  ERROR: AlertTriangle,
};

const BAND: Record<HealthBand, { label: string; tone: "success" | "warning" | "danger" }> = {
  healthy: { label: "Healthy", tone: "success" },
  watch: { label: "Watch", tone: "warning" },
  at_risk: { label: "At risk", tone: "danger" },
};

export default async function CommandCenterPage() {
  const user = await requirePagePermission("command_center.view");
  const data = await getCommandCenterData(user.role);
  const { kpis, brain } = data;
  const spendRatio = kpis.aiBudgetUsd > 0 ? kpis.aiSpendUsd / kpis.aiBudgetUsd : 0;
  const brainStatus = brain ? AGENT_STATUS[brain.status] : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Brain"
        title="Command Center"
        description="What the AI CEO and its agents are doing right now. Anything that leaves the company waits for a human."
        actions={
          can(user.role, "approvals.view") && (
            <Button asChild variant="secondary">
              <Link href="/approvals">
                <ClipboardCheck aria-hidden /> Review approvals
              </Link>
            </Button>
          )
        }
      />

      <AskBrain enabled={can(user.role, "brain.ask")} />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active agents"
          icon={Users}
          value={kpis.activeAgents}
          hint={`of ${kpis.totalAgents} company agents`}
        />
        <KpiCard
          label="Tasks completed today"
          icon={CheckCircle2}
          value={kpis.tasksDoneToday}
          hint="Across all departments"
        />
        <KpiCard
          label="Pending approvals"
          icon={ClipboardCheck}
          value={kpis.pendingApprovals}
          hint={`${kpis.restrictedPending} need an executive decision`}
        />
        <KpiCard
          label="AI spend vs budget"
          icon={DollarSign}
          value={formatUsd(kpis.aiSpendUsd)}
          hint={`${formatPercent(spendRatio)} of ${formatUsd(kpis.aiBudgetUsd)} this month · approval required at 75%`}
        >
          <Meter
            value={kpis.aiSpendUsd}
            max={kpis.aiBudgetUsd || 1}
            label="AI spend against monthly budget"
          />
        </KpiCard>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="brain-status">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-control bg-info-soft text-primary shadow-glow">
                <BrainCircuit className="size-5" aria-hidden />
              </span>
              <div>
                <CardTitle className="text-base">{brain?.name ?? "The Brain"}</CardTitle>
                <CardDescription>
                  AI CEO · human owner {brain?.owner ?? "unassigned"}
                </CardDescription>
              </div>
            </div>
            {brainStatus && (
              <Badge tone={brainStatus.tone}>
                <StatusDot tone={brainStatus.tone} live={brain?.status === "ACTIVE"} />
                {brainStatus.label}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-control border border-border bg-surface-muted p-4">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Current focus
              </p>
              <p className="mt-1 text-sm">{brain?.currentFocus ?? "Waiting for instructions."}</p>
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Last active</dt>
                <dd className="font-medium">
                  {brain?.lastActiveAt ? formatRelativeTime(brain.lastActiveAt) : "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Departments</dt>
                <dd className="font-medium tabular-nums">{data.departments.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Needs attention</dt>
                <dd className="font-medium tabular-nums">
                  {data.departments.filter((d) => d.health.band !== "healthy").length}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-col items-stretch">
            <CardTitle>AI spend, last 14 days</CardTitle>
            <CardDescription>
              Every model call is logged with agent, tokens and cost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpendChart data={data.spendSeries} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <StatusDot tone="success" live /> Live agent activity
              </CardTitle>
              <CardDescription className="mt-1">
                Latest actions across the company team.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ol className="divide-y divide-border" aria-label="Agent activity">
              {data.activity.map((item) => {
                const Icon = ACTIVITY_ICON[item.kind];
                const warn = item.kind === "ERROR" || item.kind === "FLAGGED";
                return (
                  <li key={item.id} className="flex gap-3 px-5 py-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control",
                        warn ? "bg-danger-soft text-danger" : "bg-info-soft text-primary",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{item.agent.name}</span>{" "}
                        <span className="text-muted-foreground">
                          · {item.department?.name ?? "Executive"}
                        </span>
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {item.department?.isConfidential && user.role !== "EXECUTIVE" && (
                          <Lock
                            className="mr-1 inline size-3.5 align-[-2px]"
                            aria-label="Confidential"
                          />
                        )}
                        {item.message}
                      </p>
                    </div>
                    <time
                      className="shrink-0 text-xs text-subtle-foreground tabular-nums"
                      dateTime={item.createdAt.toISOString()}
                    >
                      {formatRelativeTime(item.createdAt)}
                    </time>
                  </li>
                );
              })}
              {data.activity.length === 0 && (
                <li className="px-5 py-6 text-sm text-muted-foreground">No agent activity yet.</li>
              )}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Department health</CardTitle>
            <CardDescription>Agent status, blocked and overdue work.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3" aria-label="Department health">
              {data.departments.map((d) => {
                const band = BAND[d.health.band];
                return (
                  <li key={d.id}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
                        {d.name}
                        {d.isConfidential && (
                          <Lock
                            className="size-3.5 shrink-0 text-subtle-foreground"
                            aria-label="Confidential"
                          />
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {d.health.score}
                        </span>
                        <Badge tone={band.tone}>{band.label}</Badge>
                      </span>
                    </div>
                    <Meter
                      value={d.health.score}
                      max={100}
                      label={`${d.name} health score`}
                      tone={band.tone}
                      className="mt-1.5 h-1.5"
                    />
                    {d.health.band !== "healthy" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.health.reasons.join(" · ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
