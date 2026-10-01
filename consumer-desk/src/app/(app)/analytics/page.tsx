import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { WeekBars } from "@/components/week-bars";
import { formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { ANALYTICS_RANGES, computeAnalytics, loadDataset, type AnalyticsRange } from "@/server/services/metrics";

export const dynamic = "force-dynamic";

const RANGE_LABEL: Record<AnalyticsRange, string> = { "7": "7 days", "30": "30 days", "90": "90 days", all: "All time" };

export default async function AnalyticsPage(props: PageProps<"/analytics">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const range = (typeof sp.range === "string" && sp.range in ANALYTICS_RANGES ? sp.range : "30") as AnalyticsRange;
  const a = computeAnalytics(await loadDataset(ctx), range, ctx.timezone);

  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : "From saved records"}
        title="Analytics"
        description={`${a.start ? `${formatDate(a.start)} – ${formatDate(a.today)}` : `All records through ${formatDate(a.today)}`}. Values that cannot be calculated from saved records are shown as “Not available”, never estimated.`}
      />
      <nav className="mb-5 flex gap-1.5" aria-label="Time range">
        {(Object.keys(RANGE_LABEL) as AnalyticsRange[]).map((r) => (
          <Link key={r} href={`/analytics?range=${r}`} className="tab" aria-current={r === range ? "page" : undefined}>
            {RANGE_LABEL[r]}
          </Link>
        ))}
      </nav>
      <div className="depth-stage grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {a.cards.map((c) => (
          <div key={c.key} className="glass float-card p-4" data-testid={`analytics-${c.key}`}>
            <div className="metric-number text-2xl font-bold md:text-3xl">
              {c.value === null ? <span className="text-base text-muted">Not available</span> : c.key === "spend" ? `$${c.value.toFixed(2)}` : c.value}
            </div>
            <div className="mt-1 text-[0.7rem] font-bold uppercase tracking-wider text-soft">{c.label}</div>
            {c.note && <div className="mt-1 text-[0.7rem] text-muted">{c.note}</div>}
          </div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <WeekBars title="Letters created per week" unit="letters" points={a.weeks.map((w) => ({ week: w.week, value: w.letters }))} />
        <WeekBars title="Mailings submitted per week" unit="mailings" points={a.weeks.map((w) => ({ week: w.week, value: w.mailings }))} />
        <WeekBars title="Responses recorded per week" unit="responses" points={a.weeks.map((w) => ({ week: w.week, value: w.responses }))} />
      </div>
      <Card className="mt-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Table view</summary>
          <div className="table-wrap mt-3">
            <table className="data-table">
              <thead><tr><th>Week of</th><th>Letters created</th><th>Mailings submitted</th><th>Responses recorded</th></tr></thead>
              <tbody>
                {a.weeks.map((w) => (
                  <tr key={w.week}><td>{formatDate(w.week)}</td><td>{w.letters}</td><td>{w.mailings}</td><td>{w.responses}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </div>
  );
}
