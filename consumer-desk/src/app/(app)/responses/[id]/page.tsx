import Link from "next/link";
import { notFound } from "next/navigation";
import { updateResponseAction } from "@/app/actions/responses";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, DefinitionList, Field, PageHeader, StatusBadge } from "@/components/ui";
import { RESPONSE_STATUS, formatDate, formatDateTime } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";

export default async function ResponseReview(props: PageProps<"/responses/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await requireOwner();
  if (!uuid.safeParse(id).success) notFound();
  const r = await ctx.store.get("responses", id);
  if (!r) notFound();
  const [client, kase, mailing, doc] = await Promise.all([
    ctx.store.get("clients", r.client_id),
    ctx.store.get("cases", r.case_id),
    r.mailing_id ? ctx.store.get("mailings", r.mailing_id) : Promise.resolve(null),
    r.document_id ? ctx.store.get("documents", r.document_id) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow={`${client?.full_name} · ${kase?.title}`}
        title={`Response received ${formatDate(r.received_date)}`}
        description={
          <span className="flex flex-wrap gap-2">
            <StatusBadge map={RESPONSE_STATUS} value={r.status} />
            {ctx.isDemo && <Badge tone="violet">FICTIONAL DEMO DATA</Badge>}
          </span>
        }
        actions={<Link href="/responses" className="btn">Response Center</Link>}
      />
      {sp.created === "1" && <p className="notice notice-ok mb-4">Response saved and linked.</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="side-by-side">
        <Card title="Outgoing letter (as mailed)">
          {mailing ? (
            <>
              <iframe src={`/api/packets/${mailing.packet_id}/pdf`} title="Outgoing packet" className="h-[60vh] min-h-[420px] w-full rounded-xl border border-white/10 bg-white" />
              <Link href={`/mailings/${mailing.id}`} className="btn btn-sm mt-2">Open mailing record</Link>
            </>
          ) : (
            <p className="text-sm text-muted">This response is not linked to a specific outgoing mailing.</p>
          )}
        </Card>
        <Card title="Incoming response">
          {doc ? (
            doc.mime_type === "application/pdf" ? (
              <iframe src={`/api/documents/${doc.id}`} title="Response document" className="h-[60vh] min-h-[420px] w-full rounded-xl border border-white/10 bg-white" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${doc.id}`} alt="Response document" className="max-h-[60vh] w-full rounded-xl border border-white/10 bg-white object-contain" />
            )
          ) : (
            <p className="text-sm text-muted">No file uploaded for this response.</p>
          )}
          {doc && <a className="btn btn-sm mt-2" href={`/api/documents/${doc.id}?download=1`}>Download</a>}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <DefinitionList
            items={[
              ["From", r.sender_name || "—"],
              ["Date received", formatDate(r.received_date)],
              ["Recorded", formatDateTime(r.created_at, ctx.timezone)],
              ["Reviewed", formatDateTime(r.reviewed_at, ctx.timezone)],
              ["Client", client?.full_name],
              ["Case", kase?.title],
            ]}
          />
        </Card>
        <Card title="Review" lit>
          <ActionForm action={updateResponseAction} className="space-y-3" testId="review-form">
            <input type="hidden" name="id" value={r.id} />
            <Field label="Response status">
              <select className="select" name="status" defaultValue={r.status === "review_needed" ? "reviewed" : r.status} data-testid="response-status">
                <option value="response_received">Response received</option>
                <option value="review_needed">Review needed</option>
                <option value="reviewed">Reviewed</option>
                <option value="follow_up_required">Follow-up required</option>
                <option value="resolved">Resolved</option>
              </select>
            </Field>
            <Field label="Notes"><textarea className="textarea !min-h-[100px]" name="notes" defaultValue={r.notes} /></Field>
            <Field label="Next action"><input className="input" name="next_action" defaultValue={r.next_action} /></Field>
            <Field label="Follow-up date" hint="Creates a reminder when changed. You decide what happens next — nothing is sent automatically.">
              <input className="input" type="date" name="follow_up_date" defaultValue={r.follow_up_date ?? ""} />
            </Field>
            <SubmitButton testId="mark-reviewed">Save review</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
