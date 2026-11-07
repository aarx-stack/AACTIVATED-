import "server-only";
import { db } from "@/lib/db";

export async function getAdminData() {
  const [users, integrations, audit] = await Promise.all([
    db.user.findMany({
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
    db.integration.findMany({ orderBy: { name: "asc" } }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { actorUser: { select: { name: true, email: true } } },
    }),
  ]);
  return { users, integrations, audit };
}
