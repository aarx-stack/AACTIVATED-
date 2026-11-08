import { NextResponse } from "next/server";
import { getPublicHealth } from "@/server/health/health";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness for uptime monitors and load balancers.
 * 200 while the portal can serve (OPERATIONAL or DEGRADED), 503 only when a
 * critical component (the database) is down. Messages are omitted on purpose.
 */
export async function GET() {
  const health = await getPublicHealth();
  return NextResponse.json(
    {
      status: health.status,
      checkedAt: health.checkedAt,
      components: health.components.map((c) => ({ component: c.component, status: c.status })),
    },
    { status: health.status === "DOWN" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
