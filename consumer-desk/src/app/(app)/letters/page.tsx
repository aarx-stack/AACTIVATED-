import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { LETTER_STATUS, formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function LettersPage() {
  const ctx = await requireOwner();
  const [letters, clients, cases] = await Promise.all([ctx.store.list("letters"), ctx.store.list("clients"), ctx.store.list("cases")]);
  const clientName = new Map(clients.map((c) => [c.id, c]));
  const caseTitle = new Map(cases.map((c) => [c.id, c.title]));
  letters.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : undefined}
        title="Letters"
        description="Drafts, packets under review and approved letters. Each letter belongs to exactly one client and case."
        actions={
          <>
            <Link href="/letters/new" className="btn btn-primary">Create letter</Link>
            <Link href="/templates" className="btn">Templates</Link>
          </>
        }
      />
      <Card>
        {letters.length === 0 ? (
          <EmptyState title="No letters yet" action={<Link href="/letters/new" className="btn btn-primary btn-sm">Create letter</Link>} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Letter</th><th>Client</th><th>Case</th><th>Recipient</th><th>Document status</th><th>Version</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {letters.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/letters/${l.id}`} className="font-medium hover:text-cyan">{l.title}</Link>
                      {l.locked_at && <div className="mt-1"><Badge tone="cyan">Mailing record exists</Badge></div>}
                    </td>
                    <td className="text-soft">
                      {clientName.get(l.client_id)?.full_name}
                      {clientName.get(l.client_id)?.is_test_record && <div><Badge tone="amber">TEST RECORD</Badge></div>}
                    </td>
                    <td className="text-soft">{caseTitle.get(l.case_id)}</td>
                    <td className="text-soft">{l.recipient_name || "—"}</td>
                    <td><StatusBadge map={LETTER_STATUS} value={l.status} /></td>
                    <td className="text-soft">{l.current_version ? `v${l.current_version}` : "—"}</td>
                    <td className="text-soft">{formatDate(l.updated_at, ctx.timezone)}</td>
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
