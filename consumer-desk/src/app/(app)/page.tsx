import Link from "next/link";
import { Envelope3D } from "@/components/envelope";
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { EVENT_SOURCE, MAILING_STATUS, formatDate, formatDateTime } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { computeMetrics, followUpBuckets, loadDataset } from "@/server/services/metrics";
import { getConnectionState } from "@/server/services/provider-health";
import { todayIn } from "@/server/services/time";

export const dynamic = "force-dynamic";

const PRIMARY = [
  "total_clients",
  "active_cases",
  "draft_letters",
  "awaiting_approval",
  "ready_to_send",
  "submitted",
  "mailed",
  "delivered",
  "awaiting_response",
  "responses_received",
  "review_needed",
  "follow_ups_due",
  "closed_cases",
];

const MILESTONES = [
  ["Saved", "A letter or document is stored in Consumer Desk."],
  ["Submitted", "Consumer Desk sent the packet to the provider (or you recorded it manually)."],
  ["Accepted", "The provider confirmed it received the job. Not yet mailed; may await funding."],
  ["Production", "The provider reported the job is being printed/processed."],
  ["Postal event", "Tracking reported a delivery event. Only available for tracked services."],
  ["Response", "You recorded correspondence received back. Separate from delivery and case outcome."],
];

export default async function CommandCenter() {
  const ctx = await requireOwner();
  const today = todayIn(ctx.timezone);
  const ds = await loadDataset(ctx);
  const metrics = computeMetrics(ds, today);
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const buckets = followUpBuckets(ds.followUps, today);
  const connection = await getConnectionState(ctx);
  const audit = (await ctx.store.list("audit_events")).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 10);
  const recentClients = [...ds.clients]
    .filter((c) => !c.archived_at)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
  const statusCounts = ds.mailings.reduce<Record<string, number>>((acc, m) => {
    acc[m.mailing_status] = (acc[m.mailing_status] ?? 0) + 1;
    return acc;
  }, {});
  const attention = byKey.get("needs_attention")!;
  const clientName = new Map(ds.clients.map((c) => [c.id, c.full_name]));

  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : "Live database metrics"}
        title="Dispute Command Center"
        description="Every number below is counted from saved records. Select a card to see exactly which records it includes."
        actions={
          <>
            <Link href="/clients/new" className="btn btn-primary" data-testid="quick-add-client">
              Add client
            </Link>
            <Link href="/letters/new" className="btn">
              Create letter
            </Link>
            <Link href="/documents#upload" className="btn">
              Upload document
            </Link>
          </>
        }
      />

      {attention.count > 0 && (
        <Link href="/records/needs_attention" className="notice notice-danger mb-6 block" data-testid="attention-banner">
          <strong>{attention.count}</strong> mailing{attention.count === 1 ? "" : "s"} require attention (unknown submission
          outcome, failure, delivery exception or awaiting funding). View →
        </Link>
      )}

      <div className="depth-stage grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="metric-grid">
        {PRIMARY.map((key) => {
          const m = byKey.get(key)!;
          return (
            <Link
              key={key}
              href={`/records/${key}`}
              className="glass float-card group block p-4"
              title={m.description}
              data-testid={`metric-${key}`}
            >
              <div className="metric-number text-3xl font-bold md:text-4xl" data-testid={`metric-${key}-count`}>
                {m.count}
              </div>
              <div className="mt-1 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-soft group-hover:text-cyan">
                {m.label}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Mailing status summary" lit className="lg:col-span-2">
          <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto]">
            {ds.mailings.length === 0 ? (
              <EmptyState title="No mailings yet">Approve a packet and submit it, or record a manual mailing.</EmptyState>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(statusCounts).map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <StatusBadge map={MAILING_STATUS} value={status} />
                    <span className="font-semibold tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
            <Envelope3D className="hidden h-40 w-56 items-center justify-center md:flex" />
          </div>
          <details className="mt-4 text-sm text-soft">
            <summary className="cursor-pointer font-semibold text-ink">How milestones differ</summary>
            <ol className="mt-2 grid gap-1 sm:grid-cols-2">
              {MILESTONES.map(([k, v]) => (
                <li key={k}>
                  <strong className="text-ink">{k}:</strong> {v}
                </li>
              ))}
            </ol>
          </details>
        </Card>

        <Card title="Connection health">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Mode</dt>
              <dd className="text-right font-semibold">{ctx.policy.label}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Provider</dt>
              <dd className="text-right">{connection.descriptor?.displayName ?? "None"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Connection</dt>
              <dd className="text-right">
                <Badge tone={connection.label === "Verified" ? "green" : connection.label.startsWith("Simulated") ? "violet" : "amber"}>
                  {connection.label}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Last successful connection</dt>
              <dd className="text-right">{formatDateTime(connection.lastSuccessfulConnection, ctx.timezone)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Last successful status refresh</dt>
              <dd className="text-right">{formatDateTime(connection.lastStatusSync, ctx.timezone)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Automatic sync</dt>
              <dd className="text-right">
                <Badge tone="amber">Not configured</Badge>
              </dd>
            </div>
          </dl>
          <Link href="/test-center" className="btn btn-sm mt-4 w-full">
            Open Test Center
          </Link>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Follow-ups" actions={<Link href="/follow-ups" className="btn btn-sm">All follow-ups</Link>}>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            {[
              ["Overdue", buckets.overdue.length, "text-danger"],
              ["Due today", buckets.dueToday.length, "text-warn"],
              ["Next 7 days", buckets.next7.length, "text-cyan"],
            ].map(([label, count, color]) => (
              <div key={label as string} className="rounded-xl border border-white/10 bg-black/20 p-2">
                <div className={`text-2xl font-bold ${color}`}>{count}</div>
                <div className="text-[0.68rem] uppercase tracking-wider text-muted">{label}</div>
              </div>
            ))}
          </div>
          <ul className="space-y-2 text-sm">
            {[...buckets.overdue, ...buckets.dueToday, ...buckets.next7].slice(0, 6).map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{f.title}</span>
                  <span className="block truncate text-xs text-muted">{clientName.get(f.client_id)}</span>
                </span>
                <span className={`shrink-0 text-xs ${f.due_date < today ? "text-danger" : "text-soft"}`}>{formatDate(f.due_date)}</span>
              </li>
            ))}
            {buckets.overdue.length + buckets.dueToday.length + buckets.next7.length === 0 && (
              <li className="text-muted">Nothing due in the next 7 days.</li>
            )}
          </ul>
        </Card>

        <Card title="Recent activity" className="lg:col-span-1" actions={<Link href="/audit" className="btn btn-sm">Audit log</Link>}>
          {audit.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {audit.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <StatusBadge map={EVENT_SOURCE} value={e.source} />
                    <span className="text-xs text-muted">{formatDateTime(e.occurred_at, ctx.timezone)}</span>
                  </span>
                  <span className="text-soft">{e.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent clients" actions={<Link href="/clients" className="btn btn-sm">All clients</Link>}>
          {recentClients.length === 0 ? (
            <EmptyState title="No clients yet" action={<Link href="/clients/new" className="btn btn-primary btn-sm">Add client</Link>} />
          ) : (
            <ul className="divide-y divide-white/5">
              {recentClients.map((c) => (
                <li key={c.id}>
                  <Link href={`/clients/${c.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:text-cyan">
                    <span className="truncate font-medium">{c.full_name}</span>
                    {c.is_test_record ? <Badge tone="amber">TEST RECORD</Badge> : <span className="text-xs text-muted">{formatDate(c.updated_at)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
