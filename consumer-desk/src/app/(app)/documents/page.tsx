import { deleteDocumentAction } from "@/app/actions/records";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { UploadForm } from "@/components/upload-form";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DOCUMENT_CATEGORY, formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function DocumentsPage(props: PageProps<"/documents">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const category = typeof sp.category === "string" ? sp.category : "";
  const [documents, clients, cases] = await Promise.all([ctx.store.list("documents"), ctx.store.list("clients"), ctx.store.list("cases")]);
  const clientName = new Map(clients.map((c) => [c.id, c.full_name]));
  const caseTitle = new Map(cases.map((c) => [c.id, c.title]));
  const shown = documents.filter((d) => !category || d.category === category).sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : "Private storage"}
        title="Documents"
        description={
          ctx.isDemo
            ? "Demo files are kept in server memory only and are lost on restart. Upload fictional files only."
            : "Files are stored in a private Supabase Storage bucket. They are only downloadable through this app after owner sign-in."
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title="All documents" className="xl:col-span-3">
          <nav className="mb-3 flex gap-1.5 overflow-x-auto pb-1" aria-label="Category filter">
            <a href="/documents" className="tab" aria-current={!category ? "page" : undefined}>All</a>
            {Object.entries(DOCUMENT_CATEGORY).map(([k, l]) => (
              <a key={k} href={`/documents?category=${k}`} className="tab" aria-current={category === k ? "page" : undefined}>{l}</a>
            ))}
          </nav>
          {shown.length === 0 ? (
            <EmptyState title="No documents" />
          ) : (
            <div className="table-wrap">
              <table className="data-table" data-testid="documents-table">
                <thead><tr><th>File</th><th>Client</th><th>Case</th><th>Category</th><th>Pages</th><th>Uploaded</th><th></th></tr></thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id}>
                      <td><a className="font-medium hover:text-cyan" href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">{d.original_filename}</a></td>
                      <td className="text-soft">{clientName.get(d.client_id)}</td>
                      <td className="text-soft">{caseTitle.get(d.case_id ?? "") ?? "—"}</td>
                      <td className="text-soft">{DOCUMENT_CATEGORY[d.category]}</td>
                      <td className="text-soft">{d.page_count ?? "—"}</td>
                      <td className="text-soft">{formatDate(d.created_at, ctx.timezone)}</td>
                      <td>
                        <details>
                          <summary className="cursor-pointer text-xs text-danger">Delete</summary>
                          <ActionForm action={deleteDocumentAction} className="mt-2 space-y-2">
                            <input type="hidden" name="id" value={d.id} />
                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" required /> Confirm</label>
                            <SubmitButton className="btn btn-danger btn-sm">Delete</SubmitButton>
                          </ActionForm>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Upload document" className="xl:col-span-2" id="upload" lit>
          <UploadForm
            clients={clients.filter((c) => !c.archived_at).map((c) => ({ id: c.id, name: c.full_name }))}
            cases={cases.map((c) => ({ id: c.id, clientId: c.client_id, title: c.title }))}
            isDemo={ctx.isDemo}
          />
        </Card>
      </div>
    </div>
  );
}
