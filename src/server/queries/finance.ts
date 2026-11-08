import "server-only";
import { ApprovalStatus, ApprovalType, SpendKind, TransactionType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { startOfDay } from "@/lib/utils";
import { budgetFigures, isContinuePayload } from "@/server/budgets/service";
import { budgetState } from "@/server/budgets/rules";

const DAY = 86_400_000;
export const FINANCE_RANGES = [30, 90, 180] as const;
export type FinanceRange = (typeof FINANCE_RANGES)[number];

export function parseRange(value: string | undefined): FinanceRange {
  const n = Number(value);
  return (FINANCE_RANGES as readonly number[]).includes(n) ? (n as FinanceRange) : 30;
}

const num = (d: { toNumber(): number } | null | undefined) => (d ? d.toNumber() : 0);
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Revenue counts refunds against it; expenses are expenses. */
function totals(rows: { type: TransactionType; amountUsd: { toNumber(): number } }[]) {
  let revenue = 0;
  let expense = 0;
  for (const r of rows) {
    const v = num(r.amountUsd);
    if (r.type === TransactionType.REVENUE) revenue += v;
    else if (r.type === TransactionType.REFUND) revenue -= v;
    else expense += v;
  }
  return { revenue, expense, net: revenue - expense };
}

/** "Sales & Affiliate Success" -> "Sales", "Company (Brain)" -> "Brain": fits under a bar. */
export function shortDepartment(name: string) {
  const inParens = /\(([^)]+)\)/.exec(name)?.[1];
  const base = inParens ?? name.split(/\s*&\s*|\s+\(/)[0]!;
  return base === "Social Media" ? "Social" : base === "Human Resources" ? "HR" : base;
}

const change = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

export async function getFinance(range: FinanceRange, now = new Date()) {
  const end = now;
  const start = new Date(startOfDay(now).getTime() - (range - 1) * DAY);
  const prevStart = new Date(start.getTime() - range * DAY);

  const [txns, prevTxns, recent, aiSpend, departments, budgets, quickbooks] = await Promise.all([
    db.transaction.findMany({
      where: { occurredAt: { gte: start, lte: end } },
      select: { occurredAt: true, type: true, amountUsd: true },
    }),
    db.transaction.findMany({
      where: { occurredAt: { gte: prevStart, lt: start } },
      select: { type: true, amountUsd: true },
    }),
    db.transaction.findMany({
      orderBy: { occurredAt: "desc" },
      take: 6,
      include: { department: { select: { name: true } } },
    }),
    db.spendEvent.groupBy({
      by: ["departmentId"],
      where: { kind: SpendKind.AI_MODEL, occurredAt: { gte: start, lte: end } },
      _sum: { amountUsd: true },
    }),
    db.department.findMany({ select: { id: true, name: true } }),
    db.budget.findMany({
      where: { periodStart: { lte: now }, periodEnd: { gte: now } },
      include: {
        department: { select: { name: true } },
        approvalRequests: {
          where: { type: ApprovalType.SPEND },
          select: {
            id: true,
            title: true,
            status: true,
            payload: true,
            amountUsd: true,
            dispatchedAt: true,
          },
        },
      },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    db.integration.findUnique({ where: { provider: "QUICKBOOKS" } }),
  ]);

  // KPIs, against the previous period of the same length.
  const current = totals(txns);
  const previous = totals(prevTxns);

  // Running totals per day for the chart.
  const byDay = new Map<string, { revenue: number; expense: number }>();
  for (const t of txns) {
    const key = isoDay(t.occurredAt);
    const bucket = byDay.get(key) ?? { revenue: 0, expense: 0 };
    const v = num(t.amountUsd);
    if (t.type === TransactionType.REVENUE) bucket.revenue += v;
    else if (t.type === TransactionType.REFUND) bucket.revenue -= v;
    else bucket.expense += v;
    byDay.set(key, bucket);
  }
  const series: { date: string; revenue: number; expense: number }[] = [];
  let runRevenue = 0;
  let runExpense = 0;
  for (let d = 0; d < range; d++) {
    const key = isoDay(new Date(start.getTime() + d * DAY));
    const bucket = byDay.get(key);
    runRevenue += bucket?.revenue ?? 0;
    runExpense += bucket?.expense ?? 0;
    series.push({
      date: key,
      revenue: Math.round(runRevenue),
      expense: Math.round(runExpense),
    });
  }

  // AI spend by department. Company-level work (the Brain) has no department.
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const aiByDepartment = aiSpend
    .map((row) => {
      const department = row.departmentId
        ? (deptName.get(row.departmentId) ?? "Other")
        : "Company (Brain)";
      return {
        department,
        short: shortDepartment(department),
        usd: Math.round(num(row._sum.amountUsd) * 100) / 100,
      };
    })
    .filter((r) => r.usd > 0)
    .sort((a, b) => b.usd - a.usd);

  // Limit changes staff asked for, waiting for an executive.
  const limitChanges = await db.approvalRequest.findMany({
    where: {
      type: ApprovalType.BUDGET_CHANGE,
      status: ApprovalStatus.PENDING,
      budgetId: { in: budgets.map((b) => b.id) },
    },
    select: { id: true, budgetId: true, title: true },
  });

  // Budgets with their live state under the 75% rule.
  const budgetRows = await Promise.all(
    budgets.map(async (b) => {
      const figures = await budgetFigures(db, b);
      const state = budgetState(figures);
      const pendingContinue = b.approvalRequests.find(
        (a) => a.status === ApprovalStatus.PENDING && isContinuePayload(a.payload),
      );
      const pendingPurchases = b.approvalRequests.filter(
        (a) => a.status === ApprovalStatus.PENDING && !isContinuePayload(a.payload),
      );
      const toRecord = b.approvalRequests.filter(
        (a) =>
          a.status === ApprovalStatus.APPROVED && !isContinuePayload(a.payload) && !a.dispatchedAt,
      );
      return {
        id: b.id,
        name: b.name,
        kind: b.kind,
        department: b.department?.name ?? "Company-wide",
        limitUsd: figures.limitUsd,
        spentUsd: figures.spentUsd,
        threshold: figures.threshold,
        approvedExtraUsd: figures.approvedExtraUsd,
        state,
        alertSentAt: b.alertSentAt,
        pendingContinueId: pendingContinue?.id ?? null,
        pendingPurchases: pendingPurchases.map((a) => ({ id: a.id, title: a.title })),
        toRecord: toRecord.map((a) => ({ id: a.id, title: a.title, amountUsd: num(a.amountUsd) })),
        pendingLimitChange: limitChanges.find((c) => c.budgetId === b.id) ?? null,
      };
    }),
  );
  const budgetTotals = budgetRows.reduce(
    (acc, b) => ({ limit: acc.limit + b.limitUsd, spent: acc.spent + b.spentUsd }),
    { limit: 0, spent: 0 },
  );

  const qbConfig = (quickbooks?.config ?? {}) as {
    lastSyncAt?: string;
    syncedTransactions?: number;
  };

  return {
    range,
    start,
    kpis: {
      revenue: current.revenue,
      expense: current.expense,
      net: current.net,
      revenueChange: change(current.revenue, previous.revenue),
      expenseChange: change(current.expense, previous.expense),
      netChange: previous.net !== 0 ? (current.net - previous.net) / Math.abs(previous.net) : null,
    },
    series,
    aiByDepartment,
    budgets: budgetRows,
    budgetTotals,
    pausedBudgets: budgetRows.filter((b) => b.state.locked).length,
    pendingSpendApprovals: budgets.reduce(
      (n, b) => n + b.approvalRequests.filter((a) => a.status === ApprovalStatus.PENDING).length,
      0,
    ),
    quickbooks: quickbooks
      ? {
          mode: quickbooks.mode,
          status: quickbooks.status,
          lastSyncAt: qbConfig.lastSyncAt ? new Date(qbConfig.lastSyncAt) : null,
          syncedTransactions: qbConfig.syncedTransactions ?? null,
          lastError: quickbooks.lastError,
        }
      : null,
    recent: recent.map((t) => ({
      id: t.id,
      occurredAt: t.occurredAt,
      description: t.description,
      department: t.department?.name ?? "—",
      type: t.type,
      amountUsd: num(t.amountUsd),
      source: t.source,
    })),
  };
}

export async function getAllTransactions(take = 200) {
  const rows = await db.transaction.findMany({
    orderBy: { occurredAt: "desc" },
    take,
    include: { department: { select: { name: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    occurredAt: t.occurredAt,
    description: t.description,
    category: t.category,
    department: t.department?.name ?? "—",
    type: t.type,
    amountUsd: num(t.amountUsd),
    source: t.source,
  }));
}
