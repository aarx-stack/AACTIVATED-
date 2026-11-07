import { BrainCircuit, Lock, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { AGENT_STATUS } from "@/lib/status";
import { requirePagePermission } from "@/server/auth/session";
import { getCompanyTeam } from "@/server/queries/team";

export const metadata: Metadata = { title: "Company Team" };

export default async function CompanyTeamPage() {
  const user = await requirePagePermission("company_team.view");
  const { brain, departments } = await getCompanyTeam(user.role);
  const brainStatus = brain ? AGENT_STATUS[brain.status] : null;

  return (
    <>
      <PageHeader
        eyebrow="Brain"
        title="Company Team"
        description="The AI CEO delegates to one agent team per department. Every agent has an accountable human owner."
      />

      {/* AI CEO */}
      <div className="flex flex-col items-center">
        <Card className="w-full max-w-md p-5 shadow-glow" data-testid="org-ceo">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-info-soft text-primary">
              <BrainCircuit className="size-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{brain?.name ?? "The Brain"}</h2>
                {brainStatus && (
                  <Badge tone={brainStatus.tone}>
                    <StatusDot tone={brainStatus.tone} live={brain?.status === "ACTIVE"} />{" "}
                    {brainStatus.label}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-primary">{brain?.title ?? "AI CEO"}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                <UserRound className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
                Human owner:{" "}
                <span className="font-medium text-foreground">{brain?.owner ?? "Unassigned"}</span>
                {brain?.ownerTitle && (
                  <span className="block pl-[22px] text-xs">{brain.ownerTitle}</span>
                )}
              </p>
              {brain?.currentFocus && <p className="mt-2 text-sm">{brain.currentFocus}</p>}
            </div>
          </div>
        </Card>
        {/* connector */}
        <div aria-hidden className="h-8 w-px bg-gradient-to-b from-primary to-border" />
        <div
          aria-hidden
          className="hidden h-px w-[min(100%,72rem)] bg-gradient-to-r from-transparent via-border-strong to-transparent sm:block"
        />
      </div>

      {/* Departments */}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Departments">
        {departments.map((d) => (
          <li key={d.id}>
            <Card className="flex h-full flex-col p-5" data-testid={`dept-${d.name}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{d.name}</h3>
                {d.isConfidential && (
                  <Badge tone="warning">
                    <Lock className="size-3" aria-hidden /> Executive only
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>

              <ul className="mt-4 flex flex-1 flex-col gap-3">
                {d.agents.map((a) => {
                  const status = AGENT_STATUS[a.status];
                  const body = (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{a.title}</span>
                        <Badge tone={status.tone}>
                          <StatusDot tone={status.tone} live={a.status === "ACTIVE"} />{" "}
                          {status.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {a.name} · owner <span className="text-foreground">{a.owner}</span>
                      </p>
                      {a.currentFocus && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {a.currentFocus}
                        </p>
                      )}
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {a.canOpen ? (
                        <Link
                          href={`/agents/${a.id}`}
                          className="block rounded-control border border-border bg-surface-muted p-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div
                          className="rounded-control border border-border bg-surface-muted p-3"
                          aria-disabled
                        >
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
                {d.agents.length === 0 && (
                  <li className="text-sm text-muted-foreground">No agent assigned yet.</li>
                )}
              </ul>

              {d.owner && (
                <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                  Department owner: <span className="font-medium text-foreground">{d.owner}</span>
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
