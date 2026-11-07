import "server-only";
import {
  AgentKind,
  AgentStatus,
  ApprovalStatus,
  Role,
  SpendKind,
  TaskStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { startOfDay, startOfMonth } from "@/lib/utils";
import { scoreDepartment } from "./department-health";
import { redactFeedItem } from "./redaction";

const DAY = 24 * 60 * 60 * 1000;
const CHART_DAYS = 14;

export async function getCommandCenterData(role: Role, now = new Date()) {
  const today = startOfDay(now);
  const monthStart = startOfMonth(now);
  const chartStart = new Date(today.getTime() - (CHART_DAYS - 1) * DAY);

  const [
    brain,
    agentCounts,
    tasksDoneToday,
    pendingApprovals,
    restrictedPending,
    aiSpend,
    aiBudgets,
    spendEvents,
    activities,
    departments,
    tasksDoneYesterday,
    doneLast7,
    overdueOpen,
    openInitiatives,
    lockedBudgets,
  ] = await Promise.all([
    db.agent.findFirst({
      where: { kind: AgentKind.BRAIN },
      include: { owner: { select: { name: true } } },
    }),
    db.agent.groupBy({
      by: ["status"],
      where: { kind: { not: AgentKind.REP_POD } },
      _count: { _all: true },
    }),
    db.task.count({ where: { status: TaskStatus.DONE, completedAt: { gte: today } } }),
    db.approvalRequest.count({ where: { status: ApprovalStatus.PENDING } }),
    db.approvalRequest.count({
      where: { status: ApprovalStatus.PENDING, requiredRole: Role.EXECUTIVE },
    }),
    db.spendEvent.aggregate({
      where: { kind: SpendKind.AI_MODEL, occurredAt: { gte: monthStart } },
      _sum: { amountUsd: true },
    }),
    db.budget.aggregate({
      where: {
        kind: SpendKind.AI_MODEL,
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
      _sum: { limitUsd: true },
    }),
    db.spendEvent.findMany({
      where: { kind: SpendKind.AI_MODEL, occurredAt: { gte: chartStart } },
      select: { occurredAt: true, amountUsd: true },
    }),
    db.agentActivity.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            title: true,
            department: { select: { name: true, isConfidential: true } },
          },
        },
      },
    }),
    db.department.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        agents: { where: { kind: AgentKind.DEPARTMENT }, select: { status: true } },
        tasks: {
          where: { status: { in: [TaskStatus.BLOCKED, TaskStatus.TODO, TaskStatus.IN_PROGRESS] } },
          select: { status: true, dueAt: true },
        },
      },
    }),
    db.task.count({
      where: {
        status: TaskStatus.DONE,
        completedAt: { gte: new Date(today.getTime() - DAY), lt: today },
      },
    }),
    db.task.count({
      where: { status: TaskStatus.DONE, completedAt: { gte: new Date(now.getTime() - 7 * DAY) } },
    }),
    db.task.count({
      where: {
        status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED] },
        dueAt: { lt: now },
      },
    }),
    db.task.count({
      where: {
        parentId: null,
        status: {
          in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED],
        },
        agent: { kind: { not: AgentKind.REP_POD } },
      },
    }),
    db.budget.count({
      where: { status: "LOCKED", periodStart: { lte: now }, periodEnd: { gte: now } },
    }),
  ]);

  const totalAgents = agentCounts.reduce((n, g) => n + g._count._all, 0);
  const activeAgents = agentCounts.find((g) => g.status === AgentStatus.ACTIVE)?._count._all ?? 0;

  const dayKey = (d: Date) => startOfDay(d).toISOString().slice(0, 10);
  const spendByDay = new Map<string, number>();
  for (let i = 0; i < CHART_DAYS; i++) {
    spendByDay.set(dayKey(new Date(chartStart.getTime() + i * DAY)), 0);
  }
  for (const e of spendEvents) {
    const key = dayKey(e.occurredAt);
    const current = spendByDay.get(key);
    if (current !== undefined) spendByDay.set(key, current + e.amountUsd.toNumber());
  }

  return {
    brain: brain && {
      id: brain.id,
      name: brain.name,
      status: brain.status,
      currentFocus: brain.currentFocus,
      lastActiveAt: brain.lastActiveAt,
      owner: brain.owner.name,
    },
    kpis: {
      activeAgents,
      totalAgents,
      tasksDoneToday,
      tasksDoneYesterday,
      pendingApprovals,
      restrictedPending,
      aiSpendUsd: aiSpend._sum.amountUsd?.toNumber() ?? 0,
      aiBudgetUsd: aiBudgets._sum.limitUsd?.toNumber() ?? 0,
    },
    execution: {
      /** Share of recent work finished rather than overdue (last 7 days). */
      rate: doneLast7 + overdueOpen > 0 ? doneLast7 / (doneLast7 + overdueOpen) : 1,
      openInitiatives,
      overdueOpen,
      utilization: totalAgents > 0 ? activeAgents / totalAgents : 0,
      errorAgents: agentCounts.find((g) => g.status === AgentStatus.ERROR)?._count._all ?? 0,
      lockedBudgets,
    },
    spendSeries: [...spendByDay.entries()].map(([date, usd]) => ({
      date,
      usd: Number(usd.toFixed(2)),
    })),
    activity: activities.map((a) =>
      redactFeedItem(
        {
          id: a.id,
          kind: a.kind,
          message: a.message,
          createdAt: a.createdAt,
          agent: { id: a.agent.id, name: a.agent.name, title: a.agent.title },
          department: a.agent.department,
        },
        role,
      ),
    ),
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      slug: d.slug,
      isConfidential: d.isConfidential,
      openTasks: d.tasks.length,
      health: scoreDepartment({
        agentStatuses: d.agents.map((a) => a.status),
        blockedTasks: d.tasks.filter((t) => t.status === TaskStatus.BLOCKED).length,
        overdueTasks: d.tasks.filter((t) => t.dueAt && t.dueAt < now).length,
      }),
    })),
  };
}

export type CommandCenterData = Awaited<ReturnType<typeof getCommandCenterData>>;

/** Compact factual snapshot handed to the Brain as context. */
export function buildBrainSnapshot(data: CommandCenterData): string {
  const k = data.kpis;
  const needsAttention = data.departments.filter((d) => d.health.band !== "healthy");
  return [
    "Current company snapshot:",
    `- Agents active: ${k.activeAgents} of ${k.totalAgents}`,
    `- Tasks completed today: ${k.tasksDoneToday}`,
    `- Pending approvals: ${k.pendingApprovals} (${k.restrictedPending} need an executive)`,
    `- AI spend this month: $${k.aiSpendUsd.toFixed(2)} of $${k.aiBudgetUsd.toFixed(2)} budget`,
    ...needsAttention.map((d) => `- ${d.name} needs attention: ${d.health.reasons.join(", ")}`),
  ].join("\n");
}
