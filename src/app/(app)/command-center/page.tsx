import {
  BarChart3,
  BookOpen,
  CircleCheck,
  Clapperboard,
  Clock3,
  Code2,
  Cpu,
  CreditCard,
  Database,
  Layers,
  LifeBuoy,
  Lock,
  type LucideIcon,
  Megaphone,
  Scale,
  Share2,
  Sparkles,
  Handshake,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AskBrain } from "@/components/command-center/ask-brain";
import { ContentRequest } from "@/components/command-center/content-request";
import { KpiCard } from "@/components/command-center/kpi-card";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import type { ActivityKind } from "@/generated/prisma/enums";
import { cn, formatPercent, formatUsd } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { getMyAssistant } from "@/server/agents/assistants";
import { can } from "@/server/authz/permissions";
import { getCommandCenterData } from "@/server/queries/command-center";
import type { HealthBand } from "@/server/queries/department-health";

export const metadata: Metadata = { title: "Brain Command Center" };

const DEPT_ICON: Record<string, LucideIcon> = {
  operations: Layers,
  sales: BarChart3,
  affiliate: Handshake,
  publishing: BookOpen,
  "credit-builder": CreditCard,
  marketing: Megaphone,
  social: Share2,
  media: Clapperboard,
  finance: Database,
  legal: Scale,
  support: LifeBuoy,
  technology: Cpu,
  development: Code2,
  hr: Users,
};

const BAND: Record<HealthBand, { label: string; dot: string; text: string }> = {
  healthy: { label: "Healthy", dot: "bg-success", text: "text-success" },
  watch: { label: "Watch", dot: "bg-warning", text: "text-warning" },
  at_risk: { label: "At risk", dot: "bg-danger", text: "text-danger" },
};

const ACTIVITY_STATE: Partial<
  Record<ActivityKind, { label: string; tone: "info" | "success" | "warning" | "danger" }>
> = {
  PLANNED: { label: "Working", tone: "info" },
  DELEGATED: { label: "Working", tone: "info" },
  STARTED: { label: "Working", tone: "info" },
  DRAFTED: { label: "Working", tone: "info" },
  HANDOFF: { label: "Handoff", tone: "info" },
  COMPLIANCE_CHECKED: { label: "Completed", tone: "success" },
  SUBMITTED_FOR_APPROVAL: { label: "For approval", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  REPORTED: { label: "Completed", tone: "success" },
  FLAGGED: { label: "Flagged", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
};

function healthWord(score: number) {
  if (score >= 90) return { word: "Excellent", cls: "text-success" };
  if (score >= 75) return { word: "Good", cls: "text-success" };
  if (score >= 60) return { word: "Watch", cls: "text-warning" };
  return { word: "At risk", cls: "text-danger" };
}

export default async function CommandCenterPage() {
  const user = await requirePagePermission("command_center.view");
  const [data, assistant] = await Promise.all([
    getCommandCenterData(user.role),
    getMyAssistant(user),
  ]);
  const { kpis, brain, execution } = data;

  const spendRatio = kpis.aiBudgetUsd > 0 ? kpis.aiSpendUsd / kpis.aiBudgetUsd : 0;
  const avgHealth = data.departments.length
    ? Math.round(data.departments.reduce((n, d) => n + d.health.score, 0) / data.departments.length)
    : 0;
  const overall = healthWord(avgHealth);
  const atRisk = data.departments.filter((d) => d.health.band === "at_risk").length;
  const watching = data.departments.filter((d) => d.health.band !== "healthy").length;
  const onTrack = execution.rate >= 0.8;
  const alerts = execution.errorAgents + execution.lockedBudgets;
  const operational = brain?.status === "ACTIVE" || brain?.status === "IDLE";
  const taskDelta = kpis.tasksDoneToday - kpis.tasksDoneYesterday;

  const headline = `AI CEO — ${operational ? "Operational" : "Paused"}, ${onTrack ? "On Track" : "Needs Attention"}`;
  const summary = [
    onTrack
      ? "Agents are executing across departments and work is on schedule."
      : `${execution.overdueOpen} tasks are overdue.`,
    watching
      ? `${watching} department${watching === 1 ? "" : "s"} need${watching === 1 ? "s" : ""} attention.`
      : "Every department is healthy.",
    kpis.restrictedPending
      ? `${kpis.restrictedPending} item${kpis.restrictedPending === 1 ? "" : "s"} await an executive decision.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const chips = [
    {
      ok: atRisk === 0,
      okText: "Operations Healthy",
      badText: `${atRisk} Department${atRisk === 1 ? "" : "s"} At Risk`,
    },
    { ok: onTrack, okText: "Goals On Track", badText: "Execution Behind" },
    {
      ok: alerts === 0,
      okText: "No Critical Alerts",
      badText: `${alerts} Alert${alerts === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Brain Command Center"
        description="Your AI company operating system: plan, delegate, execute and grow with a team of AI agents. Anything that leaves the company waits for a human."
        actions={
          assistant && (
            <Button asChild variant="secondary">
              <Link href={`/agents/${assistant.id}`}>
                <Sparkles aria-hidden /> My assistant
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* AI CEO hero */}
          <Card
            className="grid gap-5 glass-hero p-6 md:grid-cols-[minmax(0,1fr)_260px]"
            data-testid="brain-status"
          >
            <div className="min-w-0">
              <p className="text-base font-semibold text-cyan">AI CEO</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">{headline}</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-foreground/85">{summary}</p>
              {brain?.currentFocus && (
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                  Current focus: {brain.currentFocus}
                </p>
              )}
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Company signals">
                {chips.map((c) => (
                  <li key={c.okText}>
                    <span
                      className={cn(
                        "inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-xs font-semibold",
                        c.ok
                          ? "border-success-line bg-success-soft"
                          : "border-warning-line bg-warning-soft",
                      )}
                    >
                      <span
                        className={cn("size-2 rounded-pill", c.ok ? "bg-success" : "bg-warning")}
                        aria-hidden
                      />
                      {c.ok ? c.okText : c.badText}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="flex flex-col justify-center gap-0 border-border md:border-l md:pl-5">
              <div className="py-2">
                <div className="flex items-center justify-between text-sm">
                  <dt>Execution Status</dt>
                  <dd className={cn("font-semibold", onTrack ? "text-cyan" : "text-warning")}>
                    {onTrack ? "On Track" : "Behind"}
                  </dd>
                </div>
                <Meter
                  value={execution.rate}
                  max={1}
                  label="Execution status"
                  tone="primary"
                  className="mt-2"
                />
                <p className="mt-1 text-right text-xs font-semibold tabular-nums">
                  {formatPercent(execution.rate)}
                </p>
              </div>
              {[
                { label: "Active Initiatives", value: String(execution.openInitiatives) },
                { label: "Agent Utilization", value: formatPercent(execution.utilization) },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between border-t border-border py-2.5 text-sm"
                >
                  <dt>{row.label}</dt>
                  <dd className="font-semibold tabular-nums">{row.value}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border py-2.5 text-sm">
                <dt>Overall Health</dt>
                <dd className={cn("text-base font-bold", overall.cls)}>{overall.word}</dd>
              </div>
            </dl>
          </Card>

          {/* KPIs */}
          <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <KpiCard
              label="Active Agents"
              icon={Users}
              value={kpis.activeAgents}
              hint={`of ${kpis.totalAgents} company agents`}
            />
            <KpiCard
              label="Tasks Completed Today"
              icon={CircleCheck}
              value={kpis.tasksDoneToday}
              delta={{
                text: `${taskDelta >= 0 ? "+" : ""}${taskDelta} vs. yesterday`,
                trend: taskDelta > 0 ? "up" : taskDelta < 0 ? "down" : "flat",
              }}
            />
            <KpiCard
              label="Pending Approvals"
              icon={Clock3}
              value={kpis.pendingApprovals}
              hint={`${kpis.restrictedPending} need an executive decision`}
            />
            <KpiCard
              label="AI Spend vs. Budget"
              icon={Database}
              value={
                <span className="whitespace-nowrap">
                  {formatUsd(kpis.aiSpendUsd)}
                  <span className="text-base font-semibold text-muted-foreground">
                    {" "}
                    / {formatUsd(kpis.aiBudgetUsd, { compact: true })}
                  </span>
                </span>
              }
            >
              <div className="flex items-center gap-3">
                <Meter
                  value={kpis.aiSpendUsd}
                  max={kpis.aiBudgetUsd || 1}
                  label="AI spend against monthly budget"
                  className="flex-1"
                />
                <span className="text-sm font-semibold tabular-nums">
                  {formatPercent(spendRatio)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Approval required at 75%
                {can(user.role, "budget.request_change") && (
                  <>
                    {" · "}
                    <Link href="/budgets" className="font-semibold text-primary hover:underline">
                      Budgets
                    </Link>
                  </>
                )}
              </p>
            </KpiCard>
          </section>

          {/* Department health */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Department Health</h2>
              <p className="text-sm">
                Overall: <span className={cn("font-bold", overall.cls)}>{overall.word}</span>
              </p>
            </div>
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6"
              aria-label="Department health"
            >
              {data.departments.map((d) => {
                const band = BAND[d.health.band];
                const Icon = DEPT_ICON[d.slug] ?? Layers;
                return (
                  <li
                    key={d.id}
                    className="flex flex-col gap-2 tile p-2.5"
                    title={d.health.reasons.join(" · ")}
                  >
                    <div className="flex items-start gap-1.5">
                      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} aria-hidden />
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-[13px] leading-snug font-semibold">
                          {d.name}
                          {d.isConfidential && (
                            <Lock
                              className="ml-1 inline size-3 align-[-1px] text-subtle-foreground"
                              aria-label="Confidential"
                            />
                          )}
                        </p>
                        <p
                          className={cn("flex items-center gap-1.5 text-xs font-medium", band.text)}
                        >
                          <span className={cn("size-1.5 rounded-pill", band.dot)} aria-hidden />
                          {band.label}
                        </p>
                      </div>
                    </div>
                    <p className="text-center text-sm font-bold tabular-nums">{d.health.score}%</p>
                    <Meter
                      value={d.health.score}
                      max={100}
                      label={`${d.name} health score`}
                      tone={
                        d.health.band === "healthy"
                          ? "primary"
                          : d.health.band === "watch"
                            ? "warning"
                            : "danger"
                      }
                      className="h-1.5"
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* Live activity */}
        <Card className="flex flex-col p-5">
          <h2 className="text-lg font-semibold">Live Activity — Agents at Work</h2>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="live-dot size-2 rounded-pill bg-success text-success" aria-hidden />{" "}
            Real-time updates from your AI team
          </p>
          <ol className="relative mt-5 flex flex-1 flex-col gap-5 pl-6" aria-label="Agent activity">
            <span
              aria-hidden
              className="absolute top-1 bottom-1 left-[7px] w-px bg-gradient-to-b from-[var(--accent-cyan)] via-[var(--border-strong)] to-transparent"
            />
            {data.activity.map((item) => {
              const state = ACTIVITY_STATE[item.kind] ?? { label: "Update", tone: "info" as const };
              return (
                <li key={item.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute top-1.5 -left-6 size-3 rounded-pill border-2 border-[var(--accent-cyan)] bg-background shadow-[0_0_10px_var(--accent-cyan)]"
                  />
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm">
                      <time
                        className="mr-2 text-xs text-muted-foreground tabular-nums"
                        dateTime={item.createdAt.toISOString()}
                      >
                        {item.createdAt.toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                      <span className="font-semibold">{item.agent.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.department?.name ?? "Executive"}
                      </span>
                    </p>
                    <Badge tone={state.tone} className="shrink-0">
                      {state.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-foreground/85">
                    {item.department?.isConfidential && user.role !== "EXECUTIVE" && (
                      <Lock
                        className="mr-1 inline size-3.5 align-[-2px]"
                        aria-label="Confidential"
                      />
                    )}
                    {item.message}
                  </p>
                </li>
              );
            })}
            {data.activity.length === 0 && (
              <li className="text-sm text-muted-foreground">No agent activity yet.</li>
            )}
          </ol>
          {can(user.role, "agent.view") && (
            <Link href="/agents" className="mt-4 text-sm font-semibold text-cyan hover:underline">
              View all agents &rsaquo;
            </Link>
          )}
        </Card>
      </div>

      <AskBrain enabled={can(user.role, "brain.ask")} />

      {can(user.role, "workflow.request") && <ContentRequest />}
    </div>
  );
}
