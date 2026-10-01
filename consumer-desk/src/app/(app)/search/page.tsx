import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { CASE_STATUS, LETTER_STATUS, MAILING_STATUS } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { globalSearch } from "@/server/services/timeline";

export const dynamic = "force-dynamic";

export default async function SearchPage(props: PageProps<"/search">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const r = await globalSearch(ctx, q);
  const total = r.clients.length + r.cases.length + r.letters.length + r.mailings.length;
  return (
    <div>
      <PageHeader title={q ? `Search: “${q}”` : "Search"} description="Private search across your own records (owner only)." />
      {q.trim().length < 2 ? (
        <Card><EmptyState title="Type at least two characters in the search bar" /></Card>
      ) : total === 0 ? (
        <Card><EmptyState title="No results" /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={`Clients (${r.clients.length})`}>
            <ul className="space-y-1.5">{r.clients.map((c) => <li key={c.id}><Link className="hover:text-cyan" href={`/clients/${c.id}`}>{c.full_name}</Link></li>)}</ul>
          </Card>
          <Card title={`Cases (${r.cases.length})`}>
            <ul className="space-y-1.5">{r.cases.map((c) => <li key={c.id} className="flex justify-between gap-2"><Link className="hover:text-cyan" href={`/clients/${c.client_id}?tab=cases#case-${c.id}`}>{c.title}</Link><StatusBadge map={CASE_STATUS} value={c.status} /></li>)}</ul>
          </Card>
          <Card title={`Letters (${r.letters.length})`}>
            <ul className="space-y-1.5">{r.letters.map((l) => <li key={l.id} className="flex justify-between gap-2"><Link className="hover:text-cyan" href={`/letters/${l.id}`}>{l.title}</Link><StatusBadge map={LETTER_STATUS} value={l.status} /></li>)}</ul>
          </Card>
          <Card title={`Mailings (${r.mailings.length})`}>
            <ul className="space-y-1.5">{r.mailings.map((m) => <li key={m.id} className="flex justify-between gap-2"><Link className="hover:text-cyan" href={`/mailings/${m.id}`}>{m.recipient_snapshot.name} {m.tracking_number ? `· ${m.tracking_number}` : ""}</Link><StatusBadge map={MAILING_STATUS} value={m.mailing_status} /></li>)}</ul>
          </Card>
        </div>
      )}
    </div>
  );
}
