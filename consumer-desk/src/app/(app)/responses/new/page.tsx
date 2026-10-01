import { recordResponseAction } from "@/app/actions/responses";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClientCasePicker } from "@/components/pickers";
import { Card, Field, PageHeader } from "@/components/ui";
import { SERVICE, formatDate } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { todayIn } from "@/server/services/time";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";

export default async function NewResponsePage(props: PageProps<"/responses/new">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const [clients, cases, mailings] = await Promise.all([ctx.store.list("clients"), ctx.store.list("cases"), ctx.store.list("mailings")]);
  const preMailing =
    typeof sp.mailing === "string" && uuid.safeParse(sp.mailing).success ? mailings.find((m) => m.id === sp.mailing) : undefined;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Record a response" description="Upload the correspondence you received (optional) and link it to the original case and outgoing mailing." />
      <Card lit>
        <ActionForm action={recordResponseAction} className="space-y-4" testId="response-form">
          <ClientCasePicker
            clients={clients.map((c) => ({ id: c.id, name: c.full_name }))}
            cases={cases.map((c) => ({ id: c.id, clientId: c.client_id, title: c.title }))}
            mailings={mailings.map((m) => ({
              id: m.id,
              clientId: m.client_id,
              caseId: m.case_id,
              label: `${m.recipient_snapshot.name ?? "Recipient"} · ${SERVICE[m.service] ?? m.service} · ${formatDate(m.mailed_at ?? m.submitted_at ?? m.created_at, ctx.timezone)}`,
            }))}
            defaultClientId={preMailing?.client_id}
            defaultCaseId={preMailing?.case_id}
            defaultMailingId={preMailing?.id}
            showMailing
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date received *"><input className="input" type="date" name="received_date" required defaultValue={todayIn(ctx.timezone)} /></Field>
            <Field label="Sender (who it is from)"><input className="input" name="sender_name" defaultValue={preMailing?.recipient_snapshot.name ?? ""} /></Field>
          </div>
          <Field label="Response file (PDF, PNG or JPEG — optional)">
            <input className="input" type="file" name="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" />
          </Field>
          {ctx.isDemo && (
            <label className="notice notice-warn flex items-start gap-2">
              <input type="checkbox" name="demo_fictional_ack" className="mt-1" />
              <span>Demo mode: if attaching a file, I confirm it is fictional and contains no real person&apos;s information.</span>
            </label>
          )}
          <Field label="Notes"><textarea className="textarea !min-h-[100px]" name="notes" /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Next action"><input className="input" name="next_action" /></Field>
            <Field label="Follow-up date" hint="Creates a reminder. Not a legal deadline."><input className="input" type="date" name="follow_up_date" /></Field>
          </div>
          <SubmitButton pendingLabel="Saving…" testId="response-submit">Save response</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
