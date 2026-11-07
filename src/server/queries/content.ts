import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { type ContentChannel, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { Actor } from "@/server/authz/permissions";
import { canAccessContent } from "@/server/content/studio";

/** Reps see their own content only, enforced in the query. */
export function contentVisibilityWhere(
  actor: Pick<Actor, "id" | "role">,
): Prisma.ContentItemWhereInput {
  if (actor.role === Role.EXECUTIVE || actor.role === Role.STAFF) return {};
  return { repId: actor.id };
}

export function parseMonth(value: string | undefined, now = new Date()) {
  const m = value?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (month >= 0 && month < 12 && year > 2000 && year < 2100) return new Date(year, month, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getContentCalendar(
  actor: Pick<Actor, "id" | "role">,
  month: Date,
  channel?: ContentChannel,
) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const base: Prisma.ContentItemWhereInput = {
    AND: [contentVisibilityWhere(actor), channel ? { channel } : {}],
  };
  const [scheduled, unscheduled] = await Promise.all([
    db.contentItem.findMany({
      where: { AND: [base, { scheduledFor: { gte: start, lt: end } }] },
      orderBy: { scheduledFor: "asc" },
      select: {
        id: true,
        title: true,
        channel: true,
        status: true,
        scheduledFor: true,
        repId: true,
        rep: { select: { name: true } },
      },
    }),
    db.contentItem.findMany({
      where: {
        AND: [
          base,
          { scheduledFor: null },
          { status: { in: ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED"] } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        title: true,
        channel: true,
        status: true,
        scheduledFor: true,
        repId: true,
        rep: { select: { name: true } },
      },
    }),
  ]);
  return { scheduled, unscheduled };
}

export async function getContentDetail(actor: Pick<Actor, "id" | "role">, id: string) {
  const item = await db.contentItem.findUnique({
    where: { id },
    include: {
      authorAgent: { select: { name: true, title: true } },
      rep: { select: { name: true } },
      scheduledBy: { select: { name: true } },
      approvalRequests: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          decidedBy: { select: { name: true } },
          complianceChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!item || !canAccessContent(actor, item)) return null;
  return item;
}

export type ContentDetail = NonNullable<Awaited<ReturnType<typeof getContentDetail>>>;
