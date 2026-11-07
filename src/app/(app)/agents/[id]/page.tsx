import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PauseButton } from "@/components/agents/pause-button";
import { PerformanceChart } from "@/components/agents/performance-chart";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { APPROVAL_STATUS, CONTENT_STATUS, TASK_STATUS } from "@/lib/labels";
import { AGENT_STATUS } from "@/lib/status";
import { formatRelativeTime, formatUsd, humanize } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { canOpenAgentWorkspace } from "@/server/authz/policies";
import { getAgentWorkspace } from "@/server/queries/agents";

export const metadata: Metadata = { title: "Agent Workspace" };

const COLUMNS: { title: string; statuses: TaskStatus[] }[] = [
  { title: "To do", statuses: ["BACKLOG", "TODO"] },
  { title: "In progress", statuses: ["IN_PROGRESS"] },
  { title: "Blocked", statuses: ["BLOCKED"] },
  { title: "In review", statuses: ["IN_REVIEW"] },
  { title: "Done (14 days)", statuses: ["DONE"] },
];

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader className="flex-col items-stretch">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-3xl text-sm whitespace-pre-line">{text}</p>
      </CardContent>
    </Card>
  );
}

export default async function AgentWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("agent.view");
  const { id } = await params;
  const gate = await db.agent.findUnique({
    where: { id },
    select: { kind: true, department: { select: { isConfidential: true } } },
  });
  if (!gate) notFound();
  // Confidential departments and reps' private agents: executive only. Enforced here, not just hidden.
  if (!canOpenAgentWorkspace(user.role, gate)) redirect("/forbidden");

  const ws = await getAgentWorkspace(id);
  if (!ws) notFound();
  const { agent } = ws;
  const status = AGENT_STATUS[agent.status];

  return (
    <>
      <Link
        href="/agents"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All agents
      </Link>
      <PageHeader
        eyebrow={agent.department?.name ?? "Executive"}
        title={`${agent.title}: ${agent.name}`}
        description={agent.currentFocus ?? undefined}
        actions={
          <>
            <Badge tone={status.tone} data-testid="agent-status">
              <StatusDot tone={status.tone} live={agent.status === "ACTIVE"} /> {status.label}
            </Badge>
            {agent.department?.isConfidential && (
              <Badge tone="warning">
                <Lock className="size-3" aria-hidden /> Executive only
              </Badge>
            )}
            {can(user.role, "agent.manage") && (
              <PauseButton agentId={agent.id} paused={agent.status === "PAUSED"} />
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Human owner", value: agent.owner.name ?? "Unassigned" },
          {
            label: "Last active",
            value: agent.lastActiveAt ? formatRelativeTime(agent.lastActiveAt) : "Never",
          },
          {
            label: "AI spend this month",
            value: `${formatUsd(ws.spendThisMonth)}${agent.budgetUsd ? ` of ${formatUsd(agent.budgetUsd)}` : ""}`,
          },
          { label: "Template", value: agent.template ?? "Company agent" },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {s.label}
            </p>
            <p className="mt-1 font-medium tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

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
          <TextBlock title="Role" text={agent.config.role} />
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Tools allowed</CardTitle>
              <CardDescription>
                The agent cannot use any tool that is not listed. Outbound actions still need a
                human approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {agent.config.toolsAllowed.map((t) => (
                <Badge key={t} tone="outline" className="font-mono">
                  {t}
                </Badge>
              ))}
              {agent.config.toolsAllowed.length === 0 && (
                <p className="text-sm text-muted-foreground">No tools.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="context">
          <TextBlock title="Context" text={agent.config.context} />
        </TabsContent>

        <TabsContent value="routine">
          <TextBlock title="Daily routine" text={agent.config.dailyRoutine} />
        </TabsContent>

        <TabsContent value="tasks">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="kanban">
            {COLUMNS.map((col) => {
              const items = ws.tasks.filter((t) => col.statuses.includes(t.status));
              return (
                <section
                  key={col.title}
                  aria-label={col.title}
                  className="flex flex-col gap-2 rounded-card border border-border bg-surface-muted p-3"
                >
                  <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {col.title} <span className="tabular-nums">{items.length}</span>
                  </h3>
                  {items.map((t) => (
                    <article
                      key={t.id}
                      className="rounded-control border border-border bg-surface-solid p-3 text-sm"
                    >
                      <p className="font-medium">{t.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge
                          tone={
                            t.priority === "URGENT" || t.priority === "HIGH" ? "warning" : "neutral"
                          }
                        >
                          {humanize(t.priority)}
                        </Badge>
                        {t.status === "BLOCKED" && (
                          <Badge tone={TASK_STATUS.BLOCKED.tone}>Blocked</Badge>
                        )}
                        {t.dueAt && t.status !== "DONE" && (
                          <span
                            className={`text-xs ${t.dueAt < new Date() ? "text-danger" : "text-muted-foreground"}`}
                          >
                            due {formatRelativeTime(t.dueAt)}
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                  {items.length === 0 && (
                    <p className="text-xs text-subtle-foreground">Nothing here.</p>
                  )}
                </section>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="handoff">
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Handoff timeline</CardTitle>
              <CardDescription>Work passed between agents.</CardDescription>
            </CardHeader>
            <CardContent>
              {ws.handoffs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No handoffs yet.</p>
              ) : (
                <ol className="relative flex flex-col gap-5 border-l border-border pl-5">
                  {ws.handoffs.map((h) => (
                    <li key={h.id} className="relative">
                      <span
                        aria-hidden
                        className="absolute top-1.5 -left-[25px] size-2.5 rounded-pill border-2 border-background bg-primary"
                      />
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {h.fromAgent.title}{" "}
                        <ArrowRight className="size-3.5 text-subtle-foreground" aria-label="to" />{" "}
                        {h.toAgent.title}
                        <Badge
                          tone={
                            h.status === "COMPLETED" || h.status === "ACCEPTED"
                              ? "success"
                              : h.status === "REJECTED"
                                ? "danger"
                                : "info"
                          }
                        >
                          {humanize(h.status)}
                        </Badge>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{h.note}</p>
                      <p className="text-xs text-subtle-foreground">
                        {formatRelativeTime(h.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="report" className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Performance, last 14 days</CardTitle>
              <CardDescription>Bars: tasks completed. Line: AI spend.</CardDescription>
            </CardHeader>
            <CardContent>
              <PerformanceChart data={ws.performance} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Outputs</CardTitle>
              <CardDescription>Content this agent produced and where it stands.</CardDescription>
            </CardHeader>
            <CardContent>
              {ws.outputs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No outputs yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {ws.outputs.map((o) => {
                    const approval = o.approvalRequests[0];
                    return (
                      <li
                        key={o.id}
                        className="flex items-center justify-between gap-2 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {approval ? (
                            <Link href={`/approvals/${approval.id}`} className="hover:underline">
                              {o.title}
                            </Link>
                          ) : (
                            o.title
                          )}
                        </span>
                        <Badge
                          tone={
                            approval
                              ? APPROVAL_STATUS[approval.status].tone
                              : CONTENT_STATUS[o.status].tone
                          }
                        >
                          {CONTENT_STATUS[o.status].label}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Reports and recent activity</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {ws.reports.map((r) => (
                <article key={r.id} className="rounded-control border border-border p-3 text-sm">
                  <p className="font-medium">
                    {r.title}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {humanize(r.period)} · {formatRelativeTime(r.createdAt)}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">{r.body}</p>
                </article>
              ))}
              <ul className="flex flex-col gap-1.5 text-sm">
                {ws.activity.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{a.message}</span>
                    <span className="shrink-0 text-xs text-subtle-foreground">
                      {formatRelativeTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
