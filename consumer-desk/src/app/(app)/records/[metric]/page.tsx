import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { METRICS, loadDataset } from "@/server/services/metrics";
import { todayIn } from "@/server/services/time";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  client: "Client",
  case: "Case",
  letter: "Letter",
  packet: "Packet",
  mailing: "Mailing",
  response: "Response",
  follow_up: "Follow-up",
};

/** Drill-down: the exact records behind a Command Center number (same selector as the count). */
export default async function MetricRecords(props: PageProps<"/records/[metric]">) {
  const { metric } = await props.params;
  const ctx = await requireOwner();
  const def = METRICS.find((m) => m.key === metric);
  if (!def) notFound();
  const records = def.select(await loadDataset(ctx), todayIn(ctx.timezone));
  return (
    <div>
      <PageHeader
        eyebrow="Command Center"
        title={`${def.label}: ${records.length}`}
        description={def.description}
        actions={<Link href="/" className="btn">Back to Command Center</Link>}
      />
      <Card>
        {records.length === 0 ? (
          <EmptyState title="No records">Nothing currently matches this metric.</EmptyState>
        ) : (
          <ul className="divide-y divide-white/5" data-testid="metric-records">
            {records.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <Link href={r.href} className="flex flex-col gap-1 py-3 hover:text-cyan sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Badge tone="blue">{KIND[r.kind]}</Badge>
                      <span className="truncate font-medium">{r.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted">{r.subtitle}</span>
                  </span>
                  <span className="text-xs text-soft">{formatDate(r.date, ctx.timezone)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
