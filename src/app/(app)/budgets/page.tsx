import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RequestChangeForm } from "@/components/budgets/request-change-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { Role } from "@/generated/prisma/enums";
import { formatPercent, formatUsd } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { listBudgetsForRequests } from "@/server/budgets/change-requests";

export const metadata: Metadata = { title: "Budgets" };

const STATUS = {
  OK: { tone: "success", label: "On track" },
  WARNING: { tone: "warning", label: "Watch" },
  LOCKED: { tone: "danger", label: "Paused: approval needed" },
} as const;

export default async function BudgetsPage() {
  const user = await requirePagePermission("budget.request_change");
  const budgets = await listBudgetsForRequests(user);
  const isExecutive = user.role === Role.EXECUTIVE;
  const requestable = budgets.filter((b) => !b.pendingChange);

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Budgets"
        description="This period's budgets and how much of each is used. Spending pauses at 75% until an executive approves more. Limit changes go to the Approval Queue."
        actions={
          isExecutive ? (
            <Button asChild variant="secondary">
              <Link href="/finance">Finance & Budget</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>This period</CardTitle>
            <CardDescription>
              Limits and use only. Transactions and revenue stay in Finance & Budget, for
              executives.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {budgets.map((b) => {
                const pill = STATUS[b.status];
                return (
                  <li
                    key={b.id}
                    className="flex flex-col gap-2.5 tile p-4"
                    data-testid="budget-item"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{b.name}</p>
                        <p className="text-xs text-muted-foreground">{b.department}</p>
                      </div>
                      <span className="text-sm tabular-nums">
                        <span className="font-semibold">{formatUsd(b.spentUsd)}</span>
                        <span className="text-muted-foreground"> / {formatUsd(b.limitUsd)}</span>
                        <span className="ml-3 text-lg font-bold">{formatPercent(b.ratio)}</span>
                      </span>
                    </div>
                    <Meter
                      value={b.ratio}
                      label={`${b.name}: ${formatPercent(b.ratio)} of budget used`}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone={pill.tone}>{pill.label}</Badge>
                      {b.pendingChange && (
                        <Link
                          href={`/approvals/${b.pendingChange.id}`}
                          className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                          data-testid="pending-change"
                        >
                          Limit change to{" "}
                          {b.pendingChange.toLimitUsd != null
                            ? formatUsd(b.pendingChange.toLimitUsd)
                            : "a new amount"}{" "}
                          waiting for approval
                          <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
              {budgets.length === 0 && (
                <li className="text-sm text-muted-foreground">No budgets this period.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Request a limit change</CardTitle>
            <CardDescription>
              {isExecutive
                ? "Executives change limits directly in Finance & Budget, with a note."
                : "An executive decides in the Approval Queue. You are notified either way."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isExecutive ? (
              <Button asChild variant="secondary">
                <Link href="/finance">Open Finance & Budget</Link>
              </Button>
            ) : requestable.length > 0 ? (
              <RequestChangeForm budgets={requestable.map((b) => ({ id: b.id, name: b.name }))} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Every budget already has a change waiting for approval.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
