import "server-only";
import { AgentKind, type Role, SpendKind, TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { startOfDay, startOfMonth } from "@/lib/utils";
import { readAgentConfig } from "@/server/agents/config";
import { canOpenAgentWorkspace } from "@/server/authz/policies";

const DAY = 24 * 60 * 60 * 1000;

export async function listCompanyAgents(role: Role, viewerId?: string) {
  const agents = await db.agent.findMany({
    where: {
      OR: [
        { kind: { in: [AgentKind.BRAIN, AgentKind.DEPARTMENT] } },
        // Personal assistants: your own; executives also see staff assistants.
        {
          kind: AgentKind.PERSONAL,
          ownerId: viewerId ?? "",
          status: { not: "PAUSED" },
        },
        ...(role === "EXECUTIVE"
          ? [{ kind: AgentKind.PERSONAL, owner: { role: { not: "EXECUTIVE" as Role } } }]
          : []),
      ],
    },
    orderBy: [{ kind: "asc" }, { department: { sortOrder: "asc" } }, { name: "asc" }],
    include: {
      department: { select: { name: true, isConfidential: true } },
      owner: { select: { name: true, role: true } },
      _count: {
        select: {
          tasks: {
            where: {
              status: {
                in: [
                  TaskStatus.TODO,
                  TaskStatus.IN_PROGRESS,
                  TaskStatus.BLOCKED,
                  TaskStatus.IN_REVIEW,
                ],
              },
            },
          },
        },
      },
    },
  });
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    title: a.title,
    kind: a.kind,
    status: a.status,
    department:
      a.kind === AgentKind.PERSONAL ? "Personal assistant" : (a.department?.name ?? "Executive"),
    isConfidential: a.department?.isConfidential ?? false,
    owner: a.owner.name,
    isMine: a.kind === AgentKind.PERSONAL && a.ownerId === viewerId,
    openTasks: a._count.tasks,
    canOpen: canOpenAgentWorkspace(
      role,
      { ...a, ownerId: a.ownerId, ownerRole: a.owner.role },
      viewerId,
    ),
  }));
}

export async function getAgentWorkspace(id: string, now = new Date()) {
  const agent = await db.agent.findUnique({
    where: { id },
    include: {
      department: { select: { name: true, isConfidential: true } },
      owner: { select: { name: true, title: true } },
      templateVersion: { select: { version: true, template: { select: { name: true } } } },
    },
  });
  if (!agent) return null;

  const chartStart = new Date(startOfDay(now).getTime() - 13 * DAY);
  const [tasks, handoffs, reports, outputs, activity, doneRecent, spendRecent, spendMonth] =
    await Promise.all([
      db.task.findMany({
        where: {
          agentId: id,
          OR: [
            { status: { not: TaskStatus.DONE } },
            { completedAt: { gte: new Date(now.getTime() - 14 * DAY) } },
          ],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 60,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueAt: true,
          completedAt: true,
          output: true,
          lastError: true,
        },
      }),
      db.handoff.findMany({
        where: { OR: [{ fromAgentId: id }, { toAgentId: id }] },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          fromAgent: { select: { name: true, title: true } },
          toAgent: { select: { name: true, title: true } },
        },
      }),
      db.report.findMany({ where: { agentId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
      db.contentItem.findMany({
        where: { authorAgentId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          approvalRequests: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true },
          },
        },
      }),
      db.agentActivity.findMany({
        where: { agentId: id },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      db.task.findMany({
        where: { agentId: id, status: TaskStatus.DONE, completedAt: { gte: chartStart } },
        select: { completedAt: true },
      }),
      db.spendEvent.findMany({
        where: { agentId: id, kind: SpendKind.AI_MODEL, occurredAt: { gte: chartStart } },
        select: { occurredAt: true, amountUsd: true },
      }),
      db.spendEvent.aggregate({
        where: { agentId: id, occurredAt: { gte: startOfMonth(now) } },
        _sum: { amountUsd: true },
      }),
    ]);

  const key = (d: Date) => startOfDay(d).toISOString().slice(0, 10);
  const series = new Map<string, { date: string; tasks: number; spend: number }>();
  for (let i = 0; i < 14; i++) {
    const date = key(new Date(chartStart.getTime() + i * DAY));
    series.set(date, { date, tasks: 0, spend: 0 });
  }
  for (const t of doneRecent) if (t.completedAt) series.get(key(t.completedAt))!.tasks++;
  for (const s of spendRecent) {
    const point = series.get(key(s.occurredAt));
    if (point) point.spend += s.amountUsd.toNumber();
  }

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      title: agent.title,
      kind: agent.kind,
      status: agent.status,
      currentFocus: agent.currentFocus,
      lastActiveAt: agent.lastActiveAt,
      department: agent.department,
      owner: agent.owner,
      budgetUsd: agent.monthlyBudgetUsd?.toNumber() ?? null,
      template: agent.templateVersion
        ? `${agent.templateVersion.template.name} v${agent.templateVersion.version}`
        : null,
      config: readAgentConfig(agent.config),
    },
    tasks,
    handoffs,
    reports,
    outputs,
    activity,
    performance: [...series.values()].map((p) => ({ ...p, spend: Number(p.spend.toFixed(2)) })),
    spendThisMonth: spendMonth._sum.amountUsd?.toNumber() ?? 0,
    week: await (async () => {
      const weekAgo = new Date(now.getTime() - 7 * DAY);
      const [done, contentCreated, spend] = await Promise.all([
        db.task.findMany({
          where: { agentId: id, status: TaskStatus.DONE, completedAt: { gte: weekAgo } },
          select: { completedAt: true, dueAt: true },
        }),
        db.contentItem.count({ where: { authorAgentId: id, createdAt: { gte: weekAgo } } }),
        db.spendEvent.aggregate({
          where: { agentId: id, occurredAt: { gte: weekAgo } },
          _sum: { amountUsd: true },
        }),
      ]);
      const withDue = done.filter((t) => t.dueAt);
      const onTime = withDue.filter((t) => t.completedAt! <= t.dueAt!).length;
      return {
        tasksCompleted: done.length,
        contentCreated,
        onTimeRate: withDue.length ? onTime / withDue.length : null,
        spendUsd: spend._sum.amountUsd?.toNumber() ?? 0,
      };
    })(),
    since: agent.createdAt,
  };
}

export type AgentWorkspace = NonNullable<Awaited<ReturnType<typeof getAgentWorkspace>>>;
