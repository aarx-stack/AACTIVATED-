import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { listClients } from "@/server/services/clients";

export const dynamic = "force-dynamic";

export default async function ClientsPage(props: PageProps<"/clients">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const includeArchived = sp.archived === "1";
  const clients = await listClients(ctx, { q, includeArchived });
  const cases = await ctx.store.list("cases");

  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : undefined}
        title="Clients"
        description="Searchable client records. Each client can have multiple cases."
        actions={<Link href="/clients/new" className="btn btn-primary">Add client</Link>}
      />
      {sp.deleted === "1" && <p className="notice notice-ok mb-4">Client permanently deleted.</p>}
      <Card>
        <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
          <input className="input" name="q" defaultValue={q} placeholder="Search name, email, phone, city or tag" aria-label="Search clients" />
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-soft">
            <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} /> Include archived
          </label>
          <button className="btn" type="submit">Search</button>
        </form>
        {clients.length === 0 ? (
          <EmptyState title={q ? "No matching clients" : "No clients yet"} action={<Link href="/clients/new" className="btn btn-primary btn-sm">Add client</Link>}>
            {q ? "Try a different search." : "Add your first client — or your own TEST RECORD."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="clients-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>Open cases</th>
                  <th>Tags</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}`} className="font-semibold text-ink hover:text-cyan">
                        {c.full_name}
                      </Link>
                      <div className="mt-1 flex gap-1">
                        {c.is_test_record && <Badge tone="amber">TEST RECORD</Badge>}
                        {c.archived_at && <Badge>Archived</Badge>}
                      </div>
                    </td>
                    <td className="text-soft">
                      <div>{c.email ?? "—"}</div>
                      <div className="text-xs">{c.phone ?? ""}</div>
                    </td>
                    <td className="text-soft">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                    <td>{cases.filter((k) => k.client_id === c.id && k.status !== "closed").length}</td>
                    <td className="text-xs text-soft">{c.tags.join(", ") || "—"}</td>
                    <td className="text-soft">{formatDate(c.updated_at, ctx.timezone)}</td>
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
