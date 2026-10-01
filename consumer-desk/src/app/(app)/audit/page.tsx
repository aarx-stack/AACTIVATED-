import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { EVENT_SOURCE, formatDateTime } from "@/lib/labels";
import { requireOwner } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function AuditPage(props: PageProps<"/audit">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const action = typeof sp.action === "string" ? sp.action : "";
  const events = (await ctx.store.list("audit_events")).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const actions = [...new Set(events.map((e) => e.action))].sort();
  const shown = events.filter((e) => !action || e.action === action).slice(0, 500);
  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only record of approvals, submissions, provider status changes, exports, deletions and edits. Contains identifiers and short summaries only — never secrets or document contents."
      />
      <Card>
        <form className="mb-4 flex gap-2">
          <select className="select max-w-sm" name="action" defaultValue={action} aria-label="Filter by action">
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button className="btn" type="submit">Filter</button>
        </form>
        <div className="table-wrap max-h-[70vh]">
          <table className="data-table" data-testid="audit-table">
            <thead><tr><th>Timestamp</th><th>Action</th><th>Record</th><th>Source</th><th>User</th><th>Summary</th><th>Metadata</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-soft">{formatDateTime(e.occurred_at, ctx.timezone)}</td>
                  <td className="font-mono text-xs">{e.action}</td>
                  <td className="font-mono text-xs text-soft">{e.record_type}{e.record_id ? `:${e.record_id.slice(0, 8)}` : ""}</td>
                  <td><StatusBadge map={EVENT_SOURCE} value={e.source} /></td>
                  <td className="text-xs text-soft">{e.actor_id ? (e.actor_id === ctx.owner.id ? ctx.owner.displayName : e.actor_id.slice(0, 8)) : "—"}</td>
                  <td>{e.summary}</td>
                  <td className="max-w-xs break-all font-mono text-[0.7rem] text-muted">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
