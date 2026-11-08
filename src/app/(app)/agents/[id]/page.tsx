import { Check, ChevronRight, FileText, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PauseButton } from "@/components/agents/pause-button";
import { PerformanceChart } from "@/components/agents/performance-chart";
import { AskAssistant } from "@/components/agents/ask-assistant";
import { TaskReview } from "@/components/agents/task-review";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { CHANNEL, CONTENT_STATUS } from "@/lib/labels";
import { AGENT_STATUS } from "@/lib/status";
import { cn, formatPercent, formatRelativeTime, formatUsd, humanize } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { canOpenAgentWorkspace } from "@/server/authz/policies";
import { readTaskOutput } from "@/server/agents/task-work";
import { getAgentWorkspace, type AgentWorkspace } from "@/server/queries/agents";

export const metadata: Metadata = { title: "Agent Workspace" };

const COLUMNS: { title: string; statuses: TaskStatus[]; band: string }[] = [
  {
    title: "To Do",
    statuses: ["BACKLOG", "TODO", "BLOCKED"],
    band: "bg-[linear-gradient(180deg,rgba(150,170,205,0.35),rgba(150,170,205,0.12))]",
  },
  {
    title: "In Progress",
    statuses: ["IN_PROGRESS"],
    band: "bg-[linear-gradient(180deg,rgba(40,130,255,0.6),rgba(20,90,220,0.25))]",
  },
  {
    title: "In Review",
    statuses: ["IN_REVIEW"],
    band: "bg-[linear-gradient(180deg,rgba(124,92,255,0.6),rgba(100,70,230,0.25))]",
  },
  {
    title: "Done",
    statuses: ["DONE"],
    band: "bg-[linear-gradient(180deg,rgba(30,200,100,0.5),rgba(20,150,80,0.2))]",
  },
];

const PRIORITY: Record<
  TaskPriority,
  { label: string; tone: "danger" | "info" | "neutral" | "warning" }
> = {
  URGENT: { label: "P1", tone: "danger" },
  HIGH: { label: "P1", tone: "danger" },
  MEDIUM: { label: "P2", tone: "info" },
  LOW: { label: "P3", tone: "neutral" },
};

function TextPanel({ title, text }: { title: string; text: string }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed whitespace-pre-line">{text}</p>
    </Card>
  );
}

function TaskBoard({ tasks, canAct }: { tasks: AgentWorkspace["tasks"]; canAct: boolean }) {
  const now = new Date();
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Task Board</h2>
      <p className="text-xs text-muted-foreground">
        Work assigned to this agent, from intake to done (last 14 days).
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="kanban">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => col.statuses.includes(t.status));
          return (
            <section
              key={col.title}
              aria-label={col.title}
              className="flex flex-col overflow-hidden tile"
            >
              <h3
                className={cn(
                  "flex items-center justify-between px-3 py-2 text-sm font-semibold",
                  col.band,
                )}
              >
                {col.title}
                <span className="rounded-pill bg-black/25 px-2 text-xs tabular-nums">
                  {items.length}
                </span>
              </h3>
              <ul className="flex flex-col gap-2 p-2">
                {items.map((t) => {
                  const p = PRIORITY[t.priority];
                  const done = t.status === "DONE";
                  return (
                    <li
                      key={t.id}
                      className="glass flex items-start gap-2.5 rounded-[12px] p-2.5 text-sm"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]",
                          done ? "border-success bg-success text-black" : "border-border-strong",
                        )}
                      >
                        {done && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "leading-snug font-medium",
                            done && "text-muted-foreground",
                          )}
                        >
                          {t.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t.status === "BLOCKED" && (
                            <span className="text-danger">Blocked · </span>
                          )}
                          {done && t.completedAt
                            ? `Completed ${t.completedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : t.dueAt
                              ? `Due ${t.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                              : "No due date"}
                          {!done && t.dueAt && t.dueAt < now && (
                            <span className="text-danger"> · overdue</span>
                          )}
                        </p>
                        {(t.output !== null || t.lastError) && (
                          <TaskReview
                            taskId={t.id}
                            title={t.title}
                            status={t.status}
                            draft={readTaskOutput(t.output)}
                            lastError={t.lastError}
                            canAct={canAct}
                          />
                        )}
                      </div>
                      <Badge tone={done ? "success" : p.tone} className="shrink-0 px-2">
                        {done ? "Done" : p.label}
                      </Badge>
                    </li>
                  );
                })}
                {items.length === 0 && (
                  <li className="px-1 py-2 text-xs text-subtle-foreground">Nothing here.</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function HandoffTimeline({
  handoffs,
  limit,
}: {
  handoffs: AgentWorkspace["handoffs"];
  limit?: number;
}) {
  const items = limit ? handoffs.slice(0, limit) : handoffs;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Handoff Timeline</h2>
      <p className="text-xs text-muted-foreground">Task flow and handoffs with other agents.</p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No handoffs yet.</p>
      ) : (
        <ol className="relative mt-4 flex flex-col gap-4 pl-7">
          <span
            aria-hidden
            className="absolute top-2 bottom-2 left-[9px] w-px bg-[var(--border-strong)]"
          />
          {items.map((h) => (
            <li key={h.id} className="relative">
              <span
                aria-hidden
                className="absolute top-0.5 -left-7 size-[18px] rounded-pill border-2 border-[var(--accent-cyan)] bg-background shadow-[0_0_10px_var(--accent-cyan)]"
              />
              <p className="text-xs text-muted-foreground">
                {h.createdAt.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
              <p className="text-sm font-semibold">
                {h.fromAgent.title} → {h.toAgent.title}
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{h.note}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Outputs({ outputs }: { outputs: AgentWorkspace["outputs"] }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Outputs</h2>
      <p className="text-xs text-muted-foreground">Content and assets generated by this agent.</p>
      {outputs.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No outputs yet.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-1/2 rounded-l-[10px] px-2 py-2 font-semibold">Title</th>
              <th className="px-2 py-2 font-semibold">Channel</th>
              <th className="rounded-r-[10px] px-2 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {outputs.slice(0, 6).map((o) => (
              <tr key={o.id} className="border-b border-border last:border-0">
                <td className="max-w-0 px-2 py-2">
                  <Link
                    href={`/content/${o.id}`}
                    className="flex items-center gap-2 truncate hover:underline"
                  >
                    <FileText className="size-4 shrink-0 text-cyan" aria-hidden />
                    <span className="truncate">{o.title}</span>
                  </Link>
                </td>
                <td className="px-2 py-2 text-xs">
                  <Badge tone="info">{CHANNEL[o.channel]}</Badge>
                </td>
                <td className="px-2 py-2 text-xs whitespace-nowrap">
                  <Badge tone={CONTENT_STATUS[o.status].tone}>
                    {CONTENT_STATUS[o.status].label.replace(" · ready to schedule", "")}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function WeeklyPerformance({ ws }: { ws: AgentWorkspace }) {
  const stats = [
    { label: "Content Created", value: String(ws.week.contentCreated) },
    { label: "Tasks Completed", value: String(ws.week.tasksCompleted) },
    {
      label: "On-Time Rate",
      value: ws.week.onTimeRate === null ? "—" : formatPercent(ws.week.onTimeRate),
    },
    { label: "AI Spend", value: formatUsd(ws.week.spendUsd) },
  ];
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Weekly Performance</h2>
      <p className="text-xs text-muted-foreground">
        Key output metrics for this agent (last 7 days).
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="tile px-2.5 py-2">
            <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
            <dd className="text-lg font-bold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <PerformanceChart data={ws.performance.slice(-7)} />
      </div>
    </Card>
  );
}

export default async function AgentWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const gate = await db.agent.findUnique({
    where: { id },
    select: {
      kind: true,
      ownerId: true,
      owner: { select: { role: true } },
      department: { select: { isConfidential: true } },
    },
  });
  if (!gate) notFound();
  // Confidential departments, reps' private agents and personal assistants: enforced here,
  // not just hidden.
  if (!canOpenAgentWorkspace(user.role, { ...gate, ownerRole: gate.owner.role }, user.id)) {
    redirect("/forbidden");
  }
  const isPersonal = gate.kind === "PERSONAL";
  const isMyAssistant = isPersonal && gate.ownerId === user.id;

  const ws = await getAgentWorkspace(id);
  if (!ws) notFound();
  const { agent } = ws;
  const status = AGENT_STATUS[agent.status];

  return (
    <div className="flex flex-col gap-5">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link href="/agents" className="hover:text-foreground">
          Agents
        </Link>
        <ChevronRight className="size-4" aria-hidden />
        <span className="text-foreground">{agent.title}</span>
      </nav>

      <Card className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
            {agent.title}{" "}
            <span className="font-semibold text-muted-foreground">· {agent.name}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {agent.currentFocus ?? agent.config.role}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={status.tone} data-testid="agent-status">
            <span
              className={cn(
                "size-1.5 rounded-pill bg-current",
                agent.status === "ACTIVE" && "live-dot",
              )}
              aria-hidden
            />
            {status.label}
          </Badge>
          {agent.department?.isConfidential && (
            <Badge tone="warning">
              <Lock className="size-3" aria-hidden /> Executive only
            </Badge>
          )}
          <span className="tile rounded-pill px-3 py-1">
            Role: {agent.department?.name ?? "Executive"}
          </span>
          <span className="tile rounded-pill px-3 py-1">
            Owner: {agent.owner.name ?? "Unassigned"}
          </span>
          <span className="tile rounded-pill px-3 py-1">
            Since:{" "}
            {ws.since.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          {can(user.role, "agent.manage") && (
            <PauseButton agentId={agent.id} paused={agent.status === "PAUSED"} />
          )}
        </div>
      </Card>

      <Tabs defaultValue="tasks">
        <TabsList aria-label="Agent sections">
          <TabsTrigger value="role">Role</TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="routine">Daily routine</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="handoff">Handoff</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="role" className="flex flex-col gap-4">
          <TextPanel title="Role" text={agent.config.role} />
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Tools allowed</h2>
            <p className="text-xs text-muted-foreground">
              The agent cannot use any tool that is not listed. Outbound actions still need a human
              approval.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {agent.config.toolsAllowed.map((t) => (
                <Badge key={t} tone="info" className="font-mono">
                  {t}
                </Badge>
              ))}
              {agent.config.toolsAllowed.length === 0 && (
                <p className="text-sm text-muted-foreground">No tools.</p>
              )}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Template: {agent.template ?? "Company agent"} · AI spend this month{" "}
              {formatUsd(ws.spendThisMonth)}
              {agent.budgetUsd ? ` of ${formatUsd(agent.budgetUsd)}` : ""} · Last active{" "}
              {agent.lastActiveAt ? formatRelativeTime(agent.lastActiveAt) : "never"}
            </p>
          </Card>
        </TabsContent>
        <TabsContent value="context">
          <TextPanel title="Context" text={agent.config.context} />
        </TabsContent>
        <TabsContent value="routine">
          <TextPanel title="Daily routine" text={agent.config.dailyRoutine} />
        </TabsContent>
        <TabsContent value="tasks" className="flex flex-col gap-4">
          {isMyAssistant && (
            <Card className="p-5">
              <h2 className="text-lg font-semibold">Ask your assistant</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                It writes an internal draft for you to review. Only you see your assistant&apos;s
                work. Nothing is sent outside the company.
              </p>
              <AskAssistant agentId={agent.id} />
            </Card>
          )}
          <TaskBoard
            tasks={ws.tasks}
            canAct={isPersonal ? isMyAssistant : can(user.role, "prompts.use")}
          />
        </TabsContent>
        <TabsContent value="handoff">
          <HandoffTimeline handoffs={ws.handoffs} />
        </TabsContent>
        <TabsContent value="report" className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Reports</h2>
            <div className="mt-3 flex flex-col gap-3">
              {ws.reports.map((r) => (
                <article key={r.id} className="tile p-3 text-sm">
                  <p className="font-semibold">
                    {r.title}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {humanize(r.period)} · {formatRelativeTime(r.createdAt)}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">{r.body}</p>
                </article>
              ))}
              {ws.reports.length === 0 && (
                <p className="text-sm text-muted-foreground">No reports yet.</p>
              )}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Performance, last 14 days</h2>
            <PerformanceChart data={ws.performance} />
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {ws.activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{a.message}</span>
                  <span className="shrink-0 text-xs text-subtle-foreground">
                    {formatRelativeTime(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-3">
        <HandoffTimeline handoffs={ws.handoffs} limit={4} />
        <Outputs outputs={ws.outputs} />
        <WeeklyPerformance ws={ws} />
      </div>
    </div>
  );
}
