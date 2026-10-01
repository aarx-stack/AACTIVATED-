import { deleteTemplateAction, saveTemplateAction } from "@/app/actions/letters";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/context";
import { listTemplates } from "@/server/services/templates";

export const dynamic = "force-dynamic";

export default async function TemplatesPage(props: PageProps<"/templates">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const templates = await listTemplates(ctx);
  return (
    <div>
      <PageHeader
        title="Templates"
        description={
          <>
            Save your own reusable letters. Use <code className="text-cyan">{"{{client.full_name}}"}</code>,{" "}
            <code className="text-cyan">{"{{client.address}}"}</code>, <code className="text-cyan">{"{{case.title}}"}</code>,{" "}
            <code className="text-cyan">{"{{case.organization}}"}</code>, <code className="text-cyan">{"{{case.account_ref}}"}</code> and{" "}
            <code className="text-cyan">{"{{today}}"}</code> to fill values from the selected records, and{" "}
            <code className="text-cyan">[[PLACEHOLDER]]</code> for facts you must write yourself (packets cannot be prepared until they are replaced).
          </>
        }
      />
      {sp.saved === "1" && <p className="notice notice-ok mb-4">Template saved.</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="New template" lit>
          <ActionForm action={saveTemplateAction} className="space-y-3">
            <Field label="Name *"><input className="input" name="name" required maxLength={120} /></Field>
            <Field label="Letter type"><input className="input" name="letter_type" placeholder="general" /></Field>
            <Field label="Body"><textarea className="textarea min-h-[260px]" name="body" /></Field>
            <SubmitButton>Save template</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-3">
          {templates.map((t) => (
            <details key={t.id} className="glass p-4">
              <summary className="flex cursor-pointer items-center justify-between gap-2">
                <span className="font-medium">{t.name}</span>
                {t.is_starter ? <Badge tone="blue">Neutral starter</Badge> : <Badge tone="cyan">Mine</Badge>}
              </summary>
              {t.is_starter ? (
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-soft">{t.body || "(blank)"}</pre>
              ) : (
                <div className="mt-3 space-y-3">
                  <ActionForm action={saveTemplateAction} className="space-y-3">
                    <input type="hidden" name="id" value={t.id} />
                    <Field label="Name"><input className="input" name="name" defaultValue={t.name} required /></Field>
                    <Field label="Letter type"><input className="input" name="letter_type" defaultValue={t.letter_type} /></Field>
                    <Field label="Body"><textarea className="textarea min-h-[200px]" name="body" defaultValue={t.body} /></Field>
                    <SubmitButton className="btn">Update</SubmitButton>
                  </ActionForm>
                  <ActionForm action={deleteTemplateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <SubmitButton className="btn btn-danger btn-sm">Delete template</SubmitButton>
                  </ActionForm>
                </div>
              )}
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
