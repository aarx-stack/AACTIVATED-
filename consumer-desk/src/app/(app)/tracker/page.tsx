import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { DELIVERY_STATUS, MAILING_STATUS, RECORD_ORIGIN, RESPONSE_STATUS, formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { TRACKER_FILTERS, filterTrackerRows, loadDataset, trackerRows, type TrackerFilter } from "@/server/services/metrics";
import { todayIn } from "@/server/services/time";

export const dynamic = "force-dynamic";

export default async function TrackerPage(props: PageProps<"/tracker">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const filter = (TRACKER_FILTERS.some(([k]) => k === sp.filter) ? sp.filter : "all") as TrackerFilter;
  const q = typeof sp.q === "string" ? sp.q : "";
  const today = todayIn(ctx.timezone);
  const all = trackerRows(await loadDataset(ctx), today, ctx.timezone, ctx.owner.displayName);
  const rows = filterTrackerRows(all, filter, q);
  const counts = new Map(TRACKER_FILTERS.map(([k]) => [k, all.filter((r) => r.stages.includes(k)).length]));

  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : undefined}
        title="Dispute Tracker"
        description="Every dispute/correspondence letter and its separate mailing, delivery and response statuses."
      />
      <Card>
        <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
          <input type="hidden" name="filter" value={filter} />
          <input className="input" name="q" defaultValue={q} placeholder="Search client, case, recipient, tracking number or provider reference" aria-label="Search tracker" />
          <button className="btn" type="submit">Search</button>
        </form>
        <nav className="mb-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Filter">
          {TRACKER_FILTERS.map(([key, label]) => (
            <Link
              key={key}
              href={`/tracker?filter=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="tab"
              aria-current={key === filter ? "page" : undefined}
              data-testid={`filter-${key}`}
            >
              {label} <span className="ml-1 text-xs opacity-70">{counts.get(key)}</span>
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No matching letters">Change the filter or search.</EmptyState>
        ) : (
          <div className="table-wrap max-h-[70vh]">
            <table className="data-table" data-testid="tracker-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Case</th>
                  <th>Recipient</th>
                  <th>Letter type</th>
                  <th>Created</th>
                  <th>Approved</th>
                  <th>Submitted</th>
                  <th>Mailing status</th>
                  <th>Tracking #</th>
                  <th>Delivery status</th>
                  <th>Response status</th>
                  <th>Follow-up</th>
                  <th>Days since mailing</th>
                  <th>Assigned to</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.letterId}>
                    <td>
                      <Link href={`/clients/${r.clientId}`} className="font-medium hover:text-cyan">{r.clientName}</Link>
                      {r.isTestRecord && <div><Badge tone="amber">TEST</Badge></div>}
                    </td>
                    <td className="text-soft">{r.caseTitle}</td>
                    <td>
                      <Link href={r.mailingId ? `/mailings/${r.mailingId}` : r.packetId ? `/packets/${r.packetId}` : `/letters/${r.letterId}`} className="hover:text-cyan">
                        {r.recipient}
                      </Link>
                    </td>
                    <td className="text-soft">{r.letterType.replace(/_/g, " ")}</td>
                    <td className="text-soft">{formatDate(r.created, ctx.timezone)}</td>
                    <td className="text-soft">{formatDate(r.approved, ctx.timezone)}</td>
                    <td className="text-soft">{formatDate(r.submitted, ctx.timezone)}</td>
                    <td>
                      <StatusBadge map={MAILING_STATUS} value={r.mailingStatus} />
                      {r.recordOrigin && <div className="mt-1"><StatusBadge map={RECORD_ORIGIN} value={r.recordOrigin} /></div>}
                      {r.providerStatusRaw && <div className="mt-1 text-[0.7rem] text-muted" title="Original provider status">{r.providerStatusRaw}</div>}
                    </td>
                    <td className="font-mono text-xs">{r.trackingNumber ?? (r.mailingId && !r.trackingSupported ? <span className="text-muted">Not available for this service</span> : "—")}</td>
                    <td><StatusBadge map={DELIVERY_STATUS} value={r.mailingId ? r.deliveryStatus : null} /></td>
                    <td><StatusBadge map={RESPONSE_STATUS} value={r.responseStatus} /></td>
                    <td className={r.followUpDate && r.followUpDate <= today ? "font-semibold text-warn" : "text-soft"}>{formatDate(r.followUpDate)}</td>
                    <td className="text-soft" title={r.daysBasis ? `Counted from ${r.daysBasis} date` : undefined}>
                      {r.daysSinceMailing ?? "—"}
                      {r.daysBasis === "submitted" && <span className="text-[0.7rem] text-muted"> (since submitted)</span>}
                    </td>
                    <td className="text-soft">{r.assignedTo}</td>
                    <td className="max-w-[16rem] text-soft">{r.nextAction || "—"}</td>
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
