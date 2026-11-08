import { BrainCircuit, ChevronRight, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { AGENT_STATUS } from "@/lib/status";
import { requirePagePermission } from "@/server/auth/session";
import { listCompanyAgents } from "@/server/queries/agents";

export const metadata: Metadata = { title: "Agent Workspace" };

export default async function AgentsPage() {
  const user = await requirePagePermission("agent.view");
  // Your own assistant first.
  const agents = (await listCompanyAgents(user.role, user.id)).sort(
    (a, b) => Number(b.isMine) - Number(a.isMine),
  );

  return (
    <>
      <PageHeader
        eyebrow="Brain"
        title="Agent Workspace"
        description="Open an agent to see its role, context, daily routine, tasks, handoffs and reports."
      />
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border" aria-label="Agents">
            {agents.map((a) => {
              const status = AGENT_STATUS[a.status];
              const body = (
                <>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-info-soft text-primary">
                    {a.kind === "BRAIN" ? (
                      <BrainCircuit className="size-4" aria-hidden />
                    ) : (
                      <span className="text-xs font-semibold">{a.name.slice(0, 2)}</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {a.title}{" "}
                      <span className="font-normal text-muted-foreground">· {a.name}</span>
                      {a.isMine && (
                        <Badge tone="info" className="ml-2">
                          Yours
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {a.department} · owner {a.owner} · {a.openTasks} open task
                      {a.openTasks === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge tone={status.tone}>
                    <StatusDot tone={status.tone} live={a.status === "ACTIVE"} /> {status.label}
                  </Badge>
                  {a.canOpen ? (
                    <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                  ) : (
                    <Lock
                      className="size-4 shrink-0 text-subtle-foreground"
                      aria-label="Executive only"
                    />
                  )}
                </>
              );
              return (
                <li key={a.id}>
                  {a.canOpen ? (
                    <Link
                      href={`/agents/${a.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-hover"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-5 py-3 opacity-70">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
