import Link from "next/link";
import { notFound } from "next/navigation";
import { approvePacketAction, createDraftFromPacketAction, requestQuoteAction } from "@/app/actions/letters";
import { manualMailingAction } from "@/app/actions/mailings";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AddressBlock, Badge, Card, DefinitionList, Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { PACKET_STATUS, SERVICE, formatAddress, formatDateTime, money } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { getPacketBundle } from "@/server/services/packets";
import { activeProvider } from "@/server/services/provider-health";

export const dynamic = "force-dynamic";

export default async function PacketPage(props: PageProps<"/packets/[id]">) {
  const { id } = await props.params;
  const ctx = await requireOwner();
  const bundle = await getPacketBundle(ctx, id);
  if (!bundle) notFound();
  const { packet, letter, client, kase, mailing } = bundle;
  const descriptor = activeProvider(ctx)?.descriptor() ?? null;
  const service = descriptor?.services.find((s) => s.value === packet.mail_options.service);
  const quoteSupported = descriptor?.capabilities.quote.supported ?? false;

  return (
    <div>
      <PageHeader
        eyebrow={`${client.full_name} · ${kase.title}`}
        title="Complete mailing packet"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge map={PACKET_STATUS} value={packet.status} />
            {packet.is_test && <Badge tone="amber">TEST RECORD</Badge>}
            {ctx.isDemo && <Badge tone="violet">FICTIONAL DEMO DATA</Badge>}
            <span className="text-xs text-muted">Letter version {bundle.version.version_no}</span>
          </span>
        }
        actions={
          <>
            <a className="btn" href={`/api/packets/${packet.id}/pdf?download=1`}>Download packet PDF</a>
            <Link className="btn" href={`/letters/${letter.id}`}>Open letter</Link>
          </>
        }
      />

      {packet.status === "invalidated" && (
        <div className="mb-4">
          <Notice tone="danger" title="This packet is no longer valid">
            {packet.invalidation_reason ?? "The letter changed."} Open the letter and prepare a new packet; it will need a fresh review.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title="Exact PDF that will be mailed" className="xl:col-span-3" lit>
          <iframe
            src={`/api/packets/${packet.id}/pdf`}
            title="Packet PDF preview"
            className="h-[70vh] min-h-[520px] w-full rounded-xl border border-white/10 bg-white"
            data-testid="packet-preview"
          />
          <p className="mt-2 text-xs text-muted">
            The printed packet is plain black-on-white. If your browser cannot show PDFs inline, use “Download packet PDF”.
          </p>
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <Card title="Sender and recipient">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="label">From</p>
                <AddressBlock lines={formatAddress(packet.sender_snapshot)} />
              </div>
              <div>
                <p className="label">To</p>
                <AddressBlock lines={formatAddress(packet.recipient_snapshot)} />
              </div>
            </div>
          </Card>
          <Card title={`Contents · ${packet.page_count} page${packet.page_count === 1 ? "" : "s"} total`}>
            <ol className="space-y-1.5 text-sm" data-testid="packet-contents">
              <li className="flex justify-between gap-2"><span>1. Letter</span><span className="text-muted">{packet.page_count - packet.attachments_snapshot.reduce((s, a) => s + a.page_count, 0)} p</span></li>
              {packet.attachments_snapshot.map((a, i) => (
                <li key={a.document_id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{i + 2}. {a.original_filename}</span>
                  <span className="shrink-0 text-muted">{a.page_count} p</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Mailing options and price">
            <DefinitionList
              items={[
                ["Service", SERVICE[packet.mail_options.service]],
                ["Return receipt", packet.mail_options.return_receipt ? "Yes" : "No"],
                [
                  "Provider support",
                  service ? (
                    service.supported ? <Badge key="s" tone="green">{service.label}</Badge> : <span key="s" className="text-warn">Not confirmed: {service.note}</span>
                  ) : (
                    "No active provider"
                  ),
                ],
                [
                  "Price",
                  packet.quote_cents !== null
                    ? `${money(packet.quote_cents, packet.quote_currency ?? "USD")} (${packet.quote_source}, ${formatDateTime(packet.quoted_at, ctx.timezone)})`
                    : quoteSupported
                      ? "Not yet quoted"
                      : `Not available — ${descriptor?.capabilities.quote.basis ?? "no provider"}`,
                ],
                ["Packet hash", <code key="h" className="break-all text-xs">{packet.packet_hash}</code>],
                ["Approved", packet.approved_at ? `${formatDateTime(packet.approved_at, ctx.timezone)} by ${packet.approved_by === ctx.owner.id ? "you" : packet.approved_by}` : "—"],
              ]}
            />
            <p className="mt-3 text-xs text-muted">
              Address placement uses a conventional window-envelope position and has not been verified against LetterStream&apos;s layout
              requirements (only available in its account documentation).
            </p>
            {quoteSupported && packet.status === "pending_review" && (
              <ActionForm action={requestQuoteAction} className="mt-3">
                <input type="hidden" name="packet_id" value={packet.id} />
                <SubmitButton className="btn btn-sm">Get quote</SubmitButton>
              </ActionForm>
            )}
          </Card>

          {packet.status === "pending_review" && (
            <Card title="Approve packet" lit>
              <ActionForm action={approvePacketAction} className="space-y-3" testId="approve-form">
                <input type="hidden" name="packet_id" value={packet.id} />
                <input type="hidden" name="packet_hash" value={packet.packet_hash} />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="reviewed_packet" required className="mt-1" data-testid="reviewed-packet" />
                  <span>I reviewed the sender, recipient, entire letter, every attachment in this order, the page count and the mailing options.</span>
                </label>
                <p className="text-xs text-muted">Approving records an immutable version (hash, recipient, options, time and approver). It does not send anything.</p>
                <SubmitButton pendingLabel="Approving…" testId="approve-packet">Approve packet</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {packet.status === "approved" && !mailing && (
            <Card title="Next step" lit>
              <div className="flex flex-col gap-2">
                <Link href={`/packets/${packet.id}/send`} className="btn btn-primary" data-testid="continue-to-send">
                  Continue to final send confirmation
                </Link>
                <form method="post" action="/api/exports/recipients">
                  <input type="hidden" name="packet_id" value={packet.id} />
                  <button type="submit" className="btn w-full">Export generic recipient CSV</button>
                </form>
                <p className="text-xs text-muted">The CSV uses this app&apos;s own columns; it is not a verified LetterStream import format.</p>
              </div>
              <details className="mt-4 rounded-xl border border-white/10 p-3">
                <summary className="cursor-pointer text-sm font-semibold">Mailed it another way? Record it manually</summary>
                <ActionForm action={manualMailingAction} className="mt-3 space-y-3">
                  <input type="hidden" name="packet_id" value={packet.id} />
                  <input type="hidden" name="service" value={packet.mail_options.service} />
                  <Field label="Where/how it was sent"><input className="input" name="provider_label" placeholder="e.g. LetterStream website, post office" /></Field>
                  <Field label="External reference"><input className="input" name="external_reference" /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Status">
                      <select className="select" name="mailing_status" defaultValue="mailed">
                        <option value="accepted">Accepted</option>
                        <option value="processing">Processing</option>
                        <option value="mailed">Mailed</option>
                      </select>
                    </Field>
                    <Field label="Date"><input className="input" type="date" name="mailed_date" /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Tracking number"><input className="input" name="tracking_number" /></Field>
                    <Field label="Actual cost (USD)"><input className="input" name="actual_cost" inputMode="decimal" /></Field>
                  </div>
                  <Field label="Notes"><input className="input" name="notes" /></Field>
                  <SubmitButton className="btn">Save as “Manually recorded”</SubmitButton>
                </ActionForm>
              </details>
            </Card>
          )}

          {mailing && (
            <Card title="Mailing record">
              <div className="flex flex-col gap-2">
                <Link href={`/mailings/${mailing.id}`} className="btn btn-primary">Open mailing record</Link>
                <ActionForm action={createDraftFromPacketAction}>
                  <input type="hidden" name="packet_id" value={packet.id} />
                  <SubmitButton className="btn w-full">Create new mailing from this packet</SubmitButton>
                </ActionForm>
                <p className="text-xs text-muted">Creates a new draft that needs its own review and approval. Nothing is resent.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
