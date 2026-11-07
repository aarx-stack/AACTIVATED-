import "server-only";
import { EarningStatus, TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { startOfDay, startOfMonth } from "@/lib/utils";
import { readAgentConfig } from "@/server/agents/config";
import { commissionProgress } from "@/server/reps/commission-plan";
import { startOfWeek } from "@/server/reps/service";

const DAY = 86_400_000;

async function teamSize(repId: string) {
  return db.repProfile.count({ where: { sponsorId: repId, user: { status: "ACTIVE" } } });
}

export async function getMyTeam(repId: string, now = new Date()) {
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY);

  const [user, agents, weekTasks, plan, contacts, followUps, myContent] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: repId },
      select: { name: true, role: true, onboardedAt: true, repProfile: true },
    }),
    db.agent.findMany({
      where: { repPod: { repId } },
      orderBy: { repRole: "asc" },
      include: {
        templateVersion: { select: { version: true } },
        _count: {
          select: {
            tasks: { where: { status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] } } },
          },
        },
      },
    }),
    db.task.findMany({
      where: {
        agent: { repPod: { repId } },
        parentId: { not: null },
        dueAt: { gte: weekStart, lt: weekEnd },
        status: { not: TaskStatus.CANCELLED },
      },
      orderBy: { dueAt: "asc" },
      include: { agent: { select: { title: true, repRole: true } } },
    }),
    db.report.findFirst({
      where: { agent: { repPod: { repId } }, period: "WEEKLY" },
      orderBy: { createdAt: "desc" },
    }),
    db.contact.findMany({
      where: { repId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
    db.approvalRequest.findMany({
      where: { contact: { repId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        status: true,
        dispatchedAt: true,
        contactId: true,
        createdAt: true,
        decisionNote: true,
      },
    }),
    db.contentItem.findMany({
      where: { repId, status: { in: ["IN_REVIEW", "APPROVED", "REJECTED"] } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, status: true, channel: true },
    }),
  ]);

  const today_ = weekTasks.filter((t) => t.dueAt && t.dueAt >= today && t.dueAt < tomorrow);
  const done = weekTasks.filter((t) => t.status === TaskStatus.DONE).length;

  return {
    user,
    agents: agents.map((a) => ({
      id: a.id,
      title: a.title,
      role: a.repRole,
      status: a.status,
      openTasks: a._count.tasks,
      templateVersion: a.templateVersion?.version ?? null,
      routine: readAgentConfig(a.config).dailyRoutine,
    })),
    today: today_,
    week: weekTasks,
    progress: { done, total: weekTasks.length },
    plan,
    contacts,
    followUps,
    myContent,
  };
}

export type MyTeam = Awaited<ReturnType<typeof getMyTeam>>;

export async function getBackOffice(repId: string, now = new Date()) {
  const month = startOfMonth(now);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [profile, thisMonth, pending, lifetime, history, payouts, team, size, lastMonth] =
    await Promise.all([
      db.repProfile.findUnique({ where: { userId: repId } }),
      db.earning.aggregate({ where: { repId, period: month }, _sum: { amountUsd: true } }),
      db.earning.aggregate({
        where: { repId, status: { in: [EarningStatus.PENDING, EarningStatus.APPROVED] } },
        _sum: { amountUsd: true },
      }),
      db.earning.aggregate({ where: { repId }, _sum: { amountUsd: true } }),
      db.earning.findMany({
        where: { repId, period: { gte: sixMonthsAgo } },
        orderBy: { period: "asc" },
      }),
      db.payout.findMany({ where: { repId }, orderBy: { paidAt: "desc" }, take: 12 }),
      db.repProfile.findMany({
        where: { sponsorId: repId },
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { name: true, role: true, status: true } } },
      }),
      teamSize(repId),
      db.earning.aggregate({ where: { repId, period: lastMonthStart }, _sum: { amountUsd: true } }),
    ]);

  const monthEarningsUsd = thisMonth._sum.amountUsd?.toNumber() ?? 0;
  const progress = commissionProgress({
    monthEarningsUsd,
    teamSize: size,
    presenterStatus: profile?.presenterStatus ?? "NONE",
  });

  const months = Array.from(
    { length: 6 },
    (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1),
  );
  const growth = months.map((m) => {
    const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const key = m.toLocaleDateString("en-US", { month: "short" });
    return {
      month: key,
      team: team.filter((t) => t.joinedAt < end).length,
      earnings: Number(
        history
          .filter((e) => e.period.getTime() === m.getTime())
          .reduce((n, e) => n + e.amountUsd.toNumber(), 0)
          .toFixed(2),
      ),
    };
  });

  return {
    profile,
    totals: {
      lastMonth: lastMonth._sum.amountUsd?.toNumber() ?? 0,
      thisMonth: monthEarningsUsd,
      pending: pending._sum.amountUsd?.toNumber() ?? 0,
      lifetime: lifetime._sum.amountUsd?.toNumber() ?? 0,
    },
    progress,
    growth,
    team: team.map((t) => ({
      name: t.user.name,
      role: t.user.role,
      status: t.user.status,
      joinedAt: t.joinedAt,
    })),
    teamSize: size,
    newMembers30d: team.filter((t) => t.joinedAt.getTime() >= now.getTime() - 30 * DAY).length,
    payouts,
    recentEarnings: [...history].reverse().slice(0, 8),
  };
}

export type BackOffice = Awaited<ReturnType<typeof getBackOffice>>;
