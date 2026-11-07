import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const DAY = 86_400_000;

export async function getAdminData(q?: string, now = new Date()) {
  const search = q?.trim();
  const userWhere: Prisma.UserWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};
  const since = new Date(now.getTime() - 30 * DAY);

  const [users, totalUsers, integrations, dbChecks] = await Promise.all([
    db.user.findMany({
      where: userWhere,
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        title: true,
        lastActiveAt: true,
      },
    }),
    db.user.count(),
    db.integration.findMany({ orderBy: { name: "asc" } }),
    db.healthCheck.findMany({
      where: { component: "database", checkedAt: { gte: since } },
      select: { status: true, latencyMs: true },
    }),
  ]);

  const operational = dbChecks.filter((c) => c.status === "OPERATIONAL").length;
  const latencies = dbChecks
    .map((c) => c.latencyMs)
    .filter((n): n is number => typeof n === "number");
  return {
    users,
    totalUsers,
    integrations,
    uptime: {
      /** Share of recorded checks in the last 30 days where the database answered. Null until checks exist. */
      ratio: dbChecks.length ? operational / dbChecks.length : null,
      checks: dbChecks.length,
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((n, l) => n + l, 0) / latencies.length)
        : null,
    },
  };
}

export async function getAuditLog(take = 100) {
  return db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { actorUser: { select: { name: true, email: true } } },
  });
}
