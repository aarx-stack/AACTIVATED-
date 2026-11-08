import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { HEALTH_STATUS } from "@/lib/status";
import { getPublicHealth } from "@/server/health/health";

export const metadata: Metadata = { title: "System status" };
export const dynamic = "force-dynamic";

const HEADLINE = {
  OPERATIONAL: "All systems operational",
  DEGRADED: "Some services are degraded. The portal is still available.",
  DOWN: "The portal is experiencing an outage.",
  UNKNOWN: "Status unknown",
} as const;

/** Public status page: labels and states only, no internal details. */
export default async function StatusPage() {
  const health = await getPublicHealth();
  const overall = HEALTH_STATUS[health.status];

  return (
    <div className="relative z-10 mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <p className="text-sm font-semibold tracking-[0.2em]">AACTIVATED AI BRAIN</p>
        <h1 className="mt-2 text-2xl font-semibold">System status</h1>
      </div>
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <StatusDot
            tone={overall.tone}
            live={health.status === "OPERATIONAL"}
            className="size-3"
          />
          <p className="font-medium">{HEADLINE[health.status]}</p>
        </div>
      </Card>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {health.components.map((c) => {
              const tone = HEALTH_STATUS[c.status];
              return (
                <li key={c.component} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="text-sm">{c.label}</span>
                  <Badge tone={tone.tone}>{tone.label}</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Checked {new Date(health.checkedAt).toUTCString()}.{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
