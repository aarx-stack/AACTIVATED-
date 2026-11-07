import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The signed-in rep's own payout history as CSV. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "back_office.view_own")) {
    return new Response("Forbidden", { status: 403 });
  }
  const payouts = await db.payout.findMany({
    where: { repId: user.id },
    orderBy: { paidAt: "desc" },
  });
  const rows = [
    ["Payout date", "Amount (USD)", "Method", "Reference"],
    ...payouts.map((p) => [
      p.paidAt.toISOString().slice(0, 10),
      p.amountUsd.toFixed(2),
      p.method,
      p.reference,
    ]),
  ];
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="payouts.csv"',
      "Cache-Control": "no-store",
    },
  });
}
