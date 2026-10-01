import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { RESPONSE_STATUS, formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { METRICS, loadDataset } from "@/server/services/metrics";
import { daysBetween, dateOnlyIn, todayIn } from "@/server/services/time";

export const dynamic = "force-dynamic";

const VIEWS = [
  ["awaiting", "Awaiting responses"],
  ["new", "New responses"],
  ["review", "Needs review"],
  ["follow_up", "Follow-up required"],
  ["resolved", "Resolved"],
] as const;

export default async function ResponseCenter(props: PageProps<"/responses">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const view = (VIEWS.some(([k]) => k === sp.view) ? sp.view : "review") as (typeof VIEWS)[number][0];
  const ds = await loadDataset(ctx);
  const today = todayIn(ctx.timezone);
  const clientName = new Map(ds.clients.map((c) => [c.id, c.full_name]));
  const caseTitle = new Map(ds.cases.map((c) => [c.id, c.title]));
  const awaiting = METRICS.find((m) => m.key === "awaiting_response")!.select(ds, today);
  const awaitingMailings = ds.mailings.filter((m) => awaiting.some((a) => a.id === m.id));
  const groups = {
    new: ds.responses.filter((r) => r.status === "response_received"),
    review: ds.responses.filter((r) => r.status === "review_needed"),
    follow_up: ds.responses.filter((r) => r.status === "follow_up_required"),
    resolved: ds.responses.filter((r) => r.status === "resolved" || r.status === "reviewed"),
  };
  const counts: Record<string, number> = { awaiting: awaitingMailings.length, ...Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])) };

  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : undefined}
        title="Response Center"
        description="Track incoming correspondence. Link each response to its case and, where possible, the outgoing letter."
        actions={<Link href="/responses/new" className="btn btn-primary" data-testid="record-response">Upload / record response</Link>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={`/responses?view=${k}`} className={`glass float-card p-3 ${k === view ? "glass-lit" : ""}`} data-testid={`rc-${k}`}>
            <div className="metric-number text-2xl font-bold">{counts[k]}</div>
            <div className="text-[0.68rem] font-bold uppercase tracking-wider text-soft">{label}</div>
          </Link>
        ))}
      </div>
      <Tabs current={view} tabs={VIEWS.map(([key, label]) => ({ key, label, href: `/responses?view=${key}` }))} />
      <Card>
        {view === "awaiting" ? (
          awaitingMailings.length === 0 ? (
            <EmptyState title="No mailings awaiting a response" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Client</th><th>Case</th><th>Recipient</th><th>Mailed / submitted</th><th>Days</th><th></th></tr></thead>
                <tbody>
                  {awaitingMailings.map((m) => {
                    const basis = m.mailed_at ?? m.submitted_at;
                    return (
                      <tr key={m.id}>
                        <td>{clientName.get(m.client_id)}</td>
                        <td className="text-soft">{caseTitle.get(m.case_id)}</td>
                        <td><Link className="hover:text-cyan" href={`/mailings/${m.id}`}>{m.recipient_snapshot.name}</Link></td>
                        <td className="text-soft">{formatDate(basis, ctx.timezone)} {m.mailed_at ? "(mailed)" : "(submitted)"}</td>
                        <td>{basis ? daysBetween(dateOnlyIn(ctx.timezone, basis), today) : "—"}</td>
                        <td><Link className="btn btn-sm" href={`/responses/new?mailing=${m.id}`}>Record response</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : groups[view].length === 0 ? (
          <EmptyState title="Nothing here" />
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="responses-table">
              <thead><tr><th>Received</th><th>Client</th><th>Case</th><th>From</th><th>Status</th><th>Next action</th><th>Follow-up</th></tr></thead>
              <tbody>
                {groups[view]
                  .sort((a, b) => b.received_date.localeCompare(a.received_date))
                  .map((r) => (
                    <tr key={r.id}>
                      <td><Link className="font-medium hover:text-cyan" href={`/responses/${r.id}`}>{formatDate(r.received_date)}</Link></td>
                      <td>{clientName.get(r.client_id)}</td>
                      <td className="text-soft">{caseTitle.get(r.case_id)}</td>
                      <td className="text-soft">{r.sender_name || "—"}</td>
                      <td><StatusBadge map={RESPONSE_STATUS} value={r.status} /></td>
                      <td className="text-soft">{r.next_action || "—"}</td>
                      <td className="text-soft">{formatDate(r.follow_up_date)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
