import { ArrowLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  MilestoneForm,
  ScoreForm,
  TradelineForm,
  TradelineStatusSelect,
} from "@/components/credit/credit-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import type { CreditBureau, CreditCategory } from "@/generated/prisma/enums";
import { AGENT_STATUS } from "@/lib/status";
import { formatUsd } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import {
  BUREAU,
  CATEGORY_LABEL,
  getCreditBuilder,
  REPORTS_TO,
  TRADELINE_KIND,
} from "@/server/finance/credit";

export const metadata: Metadata = { title: "Credit Builder" };

const STEP_TONE = {
  NOT_STARTED: { tone: "neutral", label: "Not started" },
  IN_PROGRESS: { tone: "warning", label: "In progress" },
  DONE: { tone: "success", label: "Done" },
} as const;

const date = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function CreditBuilderPage() {
  const user = await requirePagePermission("credit.manage");
  const data = await getCreditBuilder(user);
  const categories = [...new Set(data.milestones.map((m) => m.category))] as CreditCategory[];
  const bureaus = Object.keys(BUREAU) as CreditBureau[];

  return (
    <>
      <Link
        href="/finance"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Finance & Budget
      </Link>
      <PageHeader
        title="Credit Builder"
        description="A division of Finance dedicated to building the company's credit and business profile. Executive only. Scores are entered by hand from the bureaus' reports; nothing here connects to a bureau."
      />

      <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Summary">
        <Card className="flex flex-col gap-2 p-5" data-testid="credit-progress">
          <p className="text-sm text-muted-foreground">Plan progress</p>
          <p className="text-2xl font-bold tabular-nums">
            {data.progress.done} of {data.progress.total} steps
          </p>
          <Meter
            value={data.progress.done}
            max={data.progress.total || 1}
            label="Credit-building plan progress"
            tone="primary"
          />
        </Card>
        <Card className="flex flex-col gap-2 p-5">
          <p className="text-sm text-muted-foreground">Open accounts that report</p>
          <p className="text-2xl font-bold tabular-nums">{data.reportingAccounts}</p>
          <p className="text-xs text-muted-foreground">Three to five is a common first goal.</p>
        </Card>
        {(["DNB_PAYDEX", "EXPERIAN_INTELLISCORE"] as CreditBureau[]).map((b) => {
          const { latest, previous } = data.latest[b];
          const delta = latest && previous ? latest.score - previous.score : null;
          return (
            <Card key={b} className="flex flex-col gap-2 p-5">
              <p className="text-sm text-muted-foreground">{BUREAU[b].label}</p>
              <p className="text-2xl font-bold tabular-nums">
                {latest ? latest.score : "—"}
                {delta != null && delta !== 0 && (
                  <span
                    className={delta > 0 ? "ml-2 text-sm text-success" : "ml-2 text-sm text-danger"}
                  >
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {latest ? `As of ${date(latest.recordedAt)}. ` : "Not recorded yet. "}
                {BUREAU[b].good}.
              </p>
            </Card>
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Credit-building plan</CardTitle>
              <CardDescription>
                The standard steps, in order. General guidance, not financial or legal advice.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5" data-testid="credit-plan">
              {categories.map((c) => (
                <section key={c} aria-label={CATEGORY_LABEL[c]} className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                    {CATEGORY_LABEL[c]}
                  </h3>
                  {data.milestones
                    .filter((m) => m.category === c)
                    .map((m) => (
                      <div key={m.id} className="flex flex-col gap-2 tile p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{m.title}</p>
                            <p className="text-xs text-muted-foreground">{m.description}</p>
                          </div>
                          <Badge tone={STEP_TONE[m.status].tone}>
                            {STEP_TONE[m.status].label}
                            {m.completedAt ? ` · ${date(m.completedAt)}` : ""}
                          </Badge>
                        </div>
                        <MilestoneForm
                          id={m.id}
                          title={m.title}
                          status={m.status}
                          notes={m.notes}
                        />
                      </div>
                    ))}
                </section>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Business credit scores</CardTitle>
              <CardDescription>
                Record each score from the bureau&apos;s report every month.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="flex flex-col gap-2 text-sm" data-testid="credit-scores">
                {bureaus.map((b) => {
                  const { latest } = data.latest[b];
                  return (
                    <li key={b} className="flex items-center justify-between gap-2">
                      <span>{BUREAU[b].label}</span>
                      <span className="font-semibold tabular-nums">
                        {latest ? latest.score : "Not recorded"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <ScoreForm
                bureaus={bureaus.map((b) => ({
                  value: b,
                  label: BUREAU[b].label,
                  range: `${BUREAU[b].min}–${BUREAU[b].max}`,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Credit Builder team</CardTitle>
              <CardDescription>
                Give them work from the Prompt Generator or their workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {data.agents.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/agents/${a.id}`}
                      className="flex items-center gap-3 py-2.5 hover:text-primary"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {a.title} <span className="text-muted-foreground">· {a.name}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{a.currentFocus}</p>
                      </div>
                      <Badge tone={AGENT_STATUS[a.status].tone}>
                        {AGENT_STATUS[a.status].label}
                      </Badge>
                      <ChevronRight
                        className="size-4 shrink-0 text-subtle-foreground"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader className="flex-col items-stretch">
          <CardTitle>Accounts that report</CardTitle>
          <CardDescription>
            Vendor accounts, cards and credit lines in the company&apos;s name, and which bureaus
            they report to. Never enter account numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {data.tradelines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="tradelines">
              {data.tradelines.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 tile p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.vendor}</p>
                    <p className="text-xs text-muted-foreground">
                      {TRADELINE_KIND[t.kind]}
                      {t.limitUsd ? ` · limit ${formatUsd(Number(t.limitUsd))}` : ""}
                      {t.openedAt ? ` · opened ${date(t.openedAt)}` : ""} ·{" "}
                      {t.reportsTo.length
                        ? `reports to ${t.reportsTo.join(", ")}`
                        : "does not report"}
                    </p>
                    {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
                  </div>
                  <div className="w-36">
                    <TradelineStatusSelect id={t.id} vendor={t.vendor} status={t.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <details className="tile p-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer text-sm font-semibold">Add an account</summary>
            <div className="mt-4">
              <TradelineForm
                kinds={Object.entries(TRADELINE_KIND) as [string, string][]}
                bureaus={REPORTS_TO}
              />
            </div>
          </details>
        </CardContent>
      </Card>
    </>
  );
}
