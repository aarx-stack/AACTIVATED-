import {
  ArrowRight,
  Check,
  ChevronRight,
  Coins,
  Hammer,
  Layers,
  Lightbulb,
  Lock,
  Rocket,
  Search,
  ShieldAlert,
  Telescope,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ParamSelect } from "@/components/forms/param-select";
import {
  AddIdeaForm,
  AddToMapButton,
  AdvanceControl,
  ProgressControl,
  type AdvanceMode,
} from "@/components/roadmap/controls";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProjectPhase, Role } from "@/generated/prisma/enums";
import { cn, formatPercent } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import {
  decideAdvance,
  nextPhase,
  overallProgress,
  PHASE_LABEL,
  PHASES,
  stageStates,
} from "@/server/roadmap/policy";
import { getRoadmap, type RoadmapStatusFilter } from "@/server/roadmap/service";

export const metadata: Metadata = { title: "Development & Tokenization Map" };

const PHASE_META: Record<ProjectPhase, { icon: LucideIcon; sub: string }> = {
  IDEA: { icon: Lightbulb, sub: "Concept, research and validation" },
  BUILD: { icon: Hammer, sub: "Development and implementation" },
  REVIEW: { icon: Telescope, sub: "QA, compliance and approval" },
  LAUNCH: { icon: Rocket, sub: "Go live" },
};

const STATUSES: RoadmapStatusFilter[] = ["all", "active", "pending", "launched"];

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requirePagePermission("roadmap.view");
  const params = await searchParams;
  const status = STATUSES.includes(params.status as RoadmapStatusFilter)
    ? (params.status as RoadmapStatusFilter)
    : "all";
  const q = params.q?.trim() || undefined;
  const data = await getRoadmap(user, { q, status });
  const manage = can(user.role, "roadmap.manage");
  const progress = overallProgress(data.all);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Development & Tokenization Map"
        description="Every project from idea to launch. Locked steps wait for an executive decision, and the tokenization platform is mapped but cannot launch without executive approval."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <form
              action="/roadmap"
              role="search"
              className="glass flex items-center gap-2 rounded-control px-3"
            >
              <Search className="size-4 text-muted-foreground" aria-hidden />
              <label htmlFor="roadmap-search" className="sr-only">
                Search projects
              </label>
              <input
                id="roadmap-search"
                name="q"
                defaultValue={q}
                placeholder="Search projects…"
                className="h-9 w-44 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              {status !== "all" && <input type="hidden" name="status" value={status} />}
            </form>
            <ParamSelect
              id="roadmap-status"
              param="status"
              label="Status"
              value={status}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "In progress" },
                { value: "pending", label: "Pending approval" },
                { value: "launched", label: "Launched" },
              ]}
            />
          </div>
        }
      />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-4 sm:p-5">
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[780px]" data-testid="roadmap-board">
              <div className="grid grid-cols-4 gap-5" role="row">
                {PHASES.map((phase) => {
                  const Icon = PHASE_META[phase].icon;
                  return (
                    <div key={phase} className="tile px-4 py-3" role="columnheader">
                      <p className="flex items-center gap-2 text-lg font-bold">
                        <Icon className="size-5 text-cyan" aria-hidden />
                        {PHASE_LABEL[phase]}
                      </p>
                      <p className="text-xs text-muted-foreground">{PHASE_META[phase].sub}</p>
                    </div>
                  );
                })}
              </div>

              <ul className="mt-5 flex flex-col gap-5">
                {data.projects.length === 0 && (
                  <li className="py-10 text-center text-sm text-muted-foreground">
                    No projects match.
                  </li>
                )}
                {data.projects.map((p) => {
                  const states = stageStates(p);
                  const notes = (p.stageNotes ?? {}) as Partial<Record<ProjectPhase, string>>;
                  const decision = decideAdvance(user.role, p);
                  const to = nextPhase(p.phase);
                  const mode: AdvanceMode | null =
                    decision.action === "refuse" || !to
                      ? null
                      : decision.action === "request"
                        ? "request"
                        : decision.noteRequired
                          ? "decide"
                          : "advance";
                  return (
                    <li
                      key={p.id}
                      className="grid grid-cols-4 gap-5"
                      data-testid="roadmap-row"
                      aria-label={p.name}
                    >
                      {PHASES.map((phase, i) => {
                        const state = states[phase];
                        const arrow = i < PHASES.length - 1 && (
                          <ChevronRight
                            aria-hidden
                            className={cn(
                              "absolute top-1/2 -right-[18px] size-4 -translate-y-1/2",
                              state === "done" || state === "current"
                                ? "text-cyan"
                                : "text-subtle-foreground",
                            )}
                          />
                        );
                        if (state === "done") {
                          return (
                            <div key={phase} className="relative tile p-3 opacity-80">
                              <p className="flex items-center gap-1.5 text-sm font-semibold">
                                <Check className="size-4 text-success" aria-hidden />
                                {p.name}
                              </p>
                              {notes[phase] && (
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {notes[phase]}
                                </p>
                              )}
                              {arrow}
                            </div>
                          );
                        }
                        if (state === "current") {
                          const live = phase === ProjectPhase.LAUNCH;
                          return (
                            <div
                              key={phase}
                              data-testid="current-stage"
                              className={cn(
                                "relative flex flex-col gap-2 rounded-tile border p-3 shadow-glow",
                                live
                                  ? "border-success-line bg-success-soft"
                                  : "border-[var(--border-strong)] bg-info-soft",
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm leading-snug font-bold">
                                  {p.name}{" "}
                                  <span className="font-medium text-muted-foreground">
                                    ({PHASE_LABEL[phase]})
                                  </span>
                                </p>
                                {live && <Badge tone="success">Live</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {notes[phase] ?? p.description}
                              </p>
                              {!live && (
                                <div className="flex items-center gap-2">
                                  <div
                                    role="meter"
                                    aria-label={`${p.name}: ${p.progress}% of ${PHASE_LABEL[phase]}`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={p.progress}
                                    className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-muted"
                                  >
                                    <div
                                      className="h-full rounded-pill bar-fill"
                                      style={{ width: `${p.progress}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-semibold tabular-nums">
                                    {p.progress}%
                                  </span>
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge tone={live ? "success" : "info"}>{PHASE_LABEL[phase]}</Badge>
                                {p.isTokenization && (
                                  <Badge tone="violet">
                                    <Coins className="size-3" aria-hidden /> Tokenization
                                  </Badge>
                                )}
                                {p.owner?.name && (
                                  <span className="text-[11px] text-subtle-foreground">
                                    {p.owner.name}
                                  </span>
                                )}
                              </div>
                              {p.pendingApproval && p.approvalRequest ? (
                                <Link
                                  href={`/approvals/${p.approvalRequest.id}`}
                                  className="text-xs font-semibold text-warning hover:underline"
                                >
                                  {user.role === Role.EXECUTIVE
                                    ? "Decide in the Approval Queue"
                                    : "Waiting for an executive decision"}
                                </Link>
                              ) : (
                                mode &&
                                to && (
                                  <AdvanceControl
                                    projectId={p.id}
                                    mode={mode}
                                    toLabel={PHASE_LABEL[to]}
                                    tokenization={p.isTokenization}
                                  />
                                )
                              )}
                              {manage &&
                                !live &&
                                (!p.isTokenization || user.role === Role.EXECUTIVE) && (
                                  <ProgressControl projectId={p.id} value={p.progress} />
                                )}
                              {arrow}
                            </div>
                          );
                        }
                        if (state === "locked") {
                          // Only the step that was requested is "Pending Approval".
                          const waiting = p.pendingApproval && phase === to;
                          return (
                            <div
                              key={phase}
                              data-testid="locked-stage"
                              className="relative flex flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-border p-3 text-center"
                            >
                              <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                                <Lock className="size-4" aria-hidden />
                                {p.name} ({PHASE_LABEL[phase]})
                              </p>
                              <Badge tone={waiting ? "warning" : "outline"}>
                                {waiting ? "Pending Approval" : "Executive approval"}
                              </Badge>
                              {arrow}
                            </div>
                          );
                        }
                        return (
                          <div
                            key={phase}
                            className="relative flex items-center justify-center rounded-tile border border-dashed border-border/70 p-3 text-center text-xs text-subtle-foreground"
                          >
                            {state === "next" ? "Next" : "Later"}
                            {arrow}
                          </div>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="p-5" data-testid="roadmap-metrics">
            <h2 className="mb-3 text-base font-semibold">Key Metrics</h2>
            <dl className="grid grid-cols-2 gap-3">
              <Metric icon={Layers} label="Total Projects" value={data.metrics.total} />
              <Metric icon={Hammer} label="In Development" value={data.metrics.inDevelopment} />
              <Metric icon={Rocket} label="Launched" value={data.metrics.launched} />
              <Metric icon={Lock} label="Pending Approval" value={data.metrics.pendingApproval} />
            </dl>
            <div className="mt-4">
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-semibold">Project progress (all)</span>
                <span className="font-bold tabular-nums">{formatPercent(progress)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-pill bg-surface-muted">
                <div
                  className="h-full rounded-pill bar-fill"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <ul className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                {data.metrics.byPhase.map((b) => (
                  <li key={b.phase} className="tile px-1 py-2">
                    <span className="block text-lg font-bold tabular-nums">{b.count}</span>
                    <span className="text-muted-foreground">{PHASE_LABEL[b.phase]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card className="p-5" data-testid="ideas-backlog">
            <h2 className="mb-3 text-base font-semibold">Ideas Backlog ({data.backlog.length})</h2>
            {data.backlog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ideas waiting.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.backlog.map((idea) => (
                  <li key={idea.id} className="flex items-center justify-between gap-3 tile p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{idea.name}</p>
                      <p className="text-xs text-muted-foreground">{idea.description}</p>
                    </div>
                    {manage && <AddToMapButton projectId={idea.id} />}
                  </li>
                ))}
              </ul>
            )}
            {manage && (
              <details className="mt-3 tile p-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="cursor-pointer text-sm font-semibold">Add an idea</summary>
                <div className="mt-3">
                  <AddIdeaForm />
                </div>
              </details>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-5" data-testid="tokenization-guardrails">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <ShieldAlert className="size-5 text-warning" aria-hidden /> Tokenization guardrails
            </h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground marker:text-cyan">
              <li>The tokenization platform is mapped only. Nothing is issued or sold.</li>
              <li>Every step needs an executive decision with a written note.</li>
              <li>Launch is not possible without executive approval in the Approval Queue.</li>
              <li>Legal review comes before any build or launch decision.</li>
            </ul>
            {user.role === Role.EXECUTIVE && (
              <Link
                href="/knowledge?q=tokenization"
                className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                Legal considerations <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 tile p-3">
      <Icon className="size-5 shrink-0 text-cyan" aria-hidden />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-xl font-bold tabular-nums">{value}</dd>
      </div>
    </div>
  );
}
