import { createLetterAction } from "@/app/actions/letters";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClientCasePicker } from "@/components/pickers";
import { Card, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/context";
import { listTemplates } from "@/server/services/templates";

export const dynamic = "force-dynamic";

export default async function NewLetterPage(props: PageProps<"/letters/new">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const [clients, cases, templates] = await Promise.all([ctx.store.list("clients"), ctx.store.list("cases"), listTemplates(ctx)]);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create letter"
        description="Start blank or from your own template. Starter templates are neutral structure with [[PLACEHOLDERS]] for facts you supply — they contain no legal theories or promised outcomes."
      />
      <Card lit>
        <ActionForm action={createLetterAction} className="space-y-4" testId="new-letter-form">
          <ClientCasePicker
            clients={clients.filter((c) => !c.archived_at).map((c) => ({ id: c.id, name: c.full_name }))}
            cases={cases.filter((c) => c.status !== "closed").map((c) => ({ id: c.id, clientId: c.client_id, title: c.title }))}
            defaultClientId={typeof sp.client === "string" ? sp.client : undefined}
            defaultCaseId={typeof sp.case === "string" ? sp.case : undefined}
          />
          <Field label="Template">
            <select className="select" name="template_id" defaultValue="starter-blank" data-testid="template-select">
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.is_starter ? "Starter · " : "Mine · "}
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Letter title (internal, optional)">
            <input className="input" name="title" maxLength={200} />
          </Field>
          <SubmitButton pendingLabel="Creating…" testId="create-letter">Create draft</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
