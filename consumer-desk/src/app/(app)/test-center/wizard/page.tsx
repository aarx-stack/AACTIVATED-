import Link from "next/link";
import { approvePacketAction, requestQuoteAction } from "@/app/actions/letters";
import { submitMailingAction } from "@/app/actions/mailings";
import { createTestRecordAction, wizardCreateLetterAction, wizardSetServiceAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AddressFields } from "@/components/fields";
import { AddressBlock, Badge, Card, DefinitionList, Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { MAILING_STATUS, PACKET_STATUS, SERVICE, formatAddress, money } from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { getPacketBundle } from "@/server/services/packets";
import { activeProvider } from "@/server/services/provider-health";
import { getSettings } from "@/server/services/settings";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";
// Mail submission waits up to 30 s for the provider; allow headroom on serverless hosts.
export const maxDuration = 60;

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={`glass p-5 ${done ? "" : "glass-lit"}`} aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-3 flex items-center gap-3 font-semibold">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-ok/20 text-ok" : "bg-accent/30 text-ink"}`}>{done ? "✓" : n}</span>
        STEP {n} · {title}
      </h2>
      {children}
    </section>
  );
}

export default async function TestWizard(props: PageProps<"/test-center/wizard">) {
  const ctx = await requireOwner();
  const sp = await props.searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" && uuid.safeParse(sp[k]).success ? (sp[k] as string) : null);
  const clientId = pick("client");
  const caseId = pick("case");
  const packetId = pick("packet");
  const mailingId = pick("mailing");
  const descriptor = activeProvider(ctx)?.descriptor() ?? null;
  const policy = ctx.policy;

  const header = (
    <PageHeader
      eyebrow="LetterStream Test Center"
      title="Test mailing wizard"
      description="Run one complete mailing test using only your own details. Nothing is ever sent automatically."
      actions={<Link href="/test-center" className="btn">Back to Test Center</Link>}
    />
  );

  // Result screen
  if (mailingId) {
    const m = await ctx.store.get("mailings", mailingId);
    if (!m) return <div>{header}<Notice tone="danger">Mailing not found.</Notice></div>;
    return (
      <div className="max-w-3xl space-y-4">
        {header}
        <Card title="Test submission recorded" lit>
          <DefinitionList
            items={[
              ["Mailing status", <StatusBadge key="s" map={MAILING_STATUS} value={m.mailing_status} />],
              ["Provider reference", m.provider_reference ?? "None returned"],
              ["Provider status (as reported)", m.provider_status_raw ?? "—"],
              ["Mode", m.mail_mode],
              ["Awaiting funding", m.awaiting_funding ? "Yes" : "No"],
            ]}
          />
          <p className="mt-4 text-sm text-soft">
            A mailing record was created immediately. “Accepted” means the provider received the job — it does <strong>not</strong> mean the letter was
            mailed. Watch for provider-reported production, mailing and tracking events.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/mailings/${m.id}`} className="btn btn-primary">Open mailing record</Link>
            <Link href="/tracker" className="btn">View in Dispute Tracker</Link>
          </div>
        </Card>
      </div>
    );
  }

  // Steps 5–10
  if (packetId) {
    const bundle = await getPacketBundle(ctx, packetId);
    if (!bundle) return <div>{header}<Notice tone="danger">Packet not found.</Notice></div>;
    const { packet, client, mailing } = bundle;
    if (!client.is_test_record) return <div>{header}<Notice tone="danger">The wizard only works with TEST RECORD packets.</Notice></div>;
    const approved = packet.status === "approved";
    const svc = descriptor?.services.find((s) => s.value === packet.mail_options.service);
    const blockers = [
      !policy.canSubmit && policy.blockedReason,
      descriptor && !descriptor.capabilities.submit.supported && `Submission: ${descriptor.capabilities.submit.basis}`,
      descriptor && !descriptor.configured && `Missing configuration: ${descriptor.missingEnv.join(", ")}`,
      svc && !svc.supported && `${svc.label}: ${svc.note}`,
    ].filter(Boolean) as string[];
    const back = `/test-center/wizard?packet=${packet.id}`;

    return (
      <div className="space-y-4">
        {header}
        {mailing && <Notice tone="info">This packet already has a mailing record. <Link className="underline" href={`/mailings/${mailing.id}`}>Open it</Link>.</Notice>}
        {packet.status === "invalidated" && <Notice tone="danger">This packet was invalidated ({packet.invalidation_reason}). Start the wizard again.</Notice>}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Step n={5} title="Exact PDF that will be submitted" done>
            <iframe src={`/api/packets/${packet.id}/pdf`} title="Test packet PDF" className="h-[60vh] min-h-[460px] w-full rounded-xl border border-white/10 bg-white" data-testid="wizard-pdf" />
            <p className="mt-2 text-xs text-muted">STEP 4 (generate the actual PDF) is complete: {packet.page_count} page(s), SHA-256 {packet.pdf_sha256.slice(0, 16)}…</p>
          </Step>
          <div className="space-y-4">
            <Step n={6} title="Choose mailing option" done={approved}>
              {descriptor?.services.some((s) => s.supported) ? (
                <ActionForm action={wizardSetServiceAction} className="space-y-2">
                  <input type="hidden" name="packet_id" value={packet.id} />
                  {descriptor.services.filter((s) => s.supported).map((s) => (
                    <label key={s.value} className="flex items-center gap-2 text-sm">
                      <input type="radio" name="service" value={s.value} defaultChecked={packet.mail_options.service === s.value} disabled={approved} /> {s.label}
                    </label>
                  ))}
                  {descriptor.services.some((s) => s.supported && s.supportsReturnReceipt) && (
                    <label className="flex items-center gap-2 pl-6 text-sm">
                      <input type="checkbox" name="return_receipt" defaultChecked={packet.mail_options.return_receipt} disabled={approved} /> Return receipt (Certified only)
                    </label>
                  )}
                  {!approved && <SubmitButton className="btn btn-sm">Apply option (regenerates packet)</SubmitButton>}
                </ActionForm>
              ) : (
                <Notice tone="warn">No mailing option is confirmed for {descriptor?.displayName ?? "the active provider"}. {descriptor?.services[0]?.note}</Notice>
              )}
            </Step>
            <Step n={7} title="Pricing / quote" done={approved}>
              {descriptor?.capabilities.quote.supported ? (
                packet.quote_cents !== null ? (
                  <p className="text-sm">Quoted: {money(packet.quote_cents, packet.quote_currency ?? "USD")}</p>
                ) : (
                  <ActionForm action={requestQuoteAction}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    <SubmitButton className="btn btn-sm">Get quote</SubmitButton>
                  </ActionForm>
                )
              ) : (
                <p className="text-sm text-soft">Not available: {descriptor?.capabilities.quote.basis ?? "no provider"}</p>
              )}
            </Step>
            <Step n={8} title="Review summary" done={approved}>
              <DefinitionList
                items={[
                  ["Recipient", <AddressBlock key="r" lines={formatAddress(packet.recipient_snapshot)} />],
                  ["Pages", packet.page_count],
                  ["Mailing type", `${SERVICE[packet.mail_options.service]}${packet.mail_options.return_receipt ? " + return receipt" : ""}`],
                  ["Estimated / quoted cost", packet.quote_cents !== null ? money(packet.quote_cents) : "Not available"],
                  ["Environment / mode", <Badge key="m" tone={policy.mayCreateRealMail ? "red" : "cyan"}>{policy.label}</Badge>],
                  ["Packet", <StatusBadge key="p" map={PACKET_STATUS} value={packet.status} />],
                ]}
              />
            </Step>
          </div>
        </div>

        {packet.status === "pending_review" && (
          <Step n={9} title="Confirm your review">
            <ActionForm action={approvePacketAction} className="space-y-2" testId="wizard-approve">
              <input type="hidden" name="packet_id" value={packet.id} />
              <input type="hidden" name="packet_hash" value={packet.packet_hash} />
              <input type="hidden" name="require_recipient_review" value="1" />
              <input type="hidden" name="return_to" value={back} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed_recipient" required /> I reviewed the recipient.</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed_packet" required /> I reviewed the PDF.</label>
              <SubmitButton pendingLabel="Approving…">Approve test packet</SubmitButton>
            </ActionForm>
          </Step>
        )}

        {approved && !mailing && (
          <Step n={10} title="Send test mail">
            {policy.mayCreateRealMail && (
              <div className="mb-3">
                <Notice tone="danger" title="THIS ACTION MAY CREATE A REAL MAILING AND INCUR A CHARGE." >
                  LetterStream&apos;s test behaviour is not publicly documented, so this test is treated as possibly real and chargeable.
                </Notice>
              </div>
            )}
            {blockers.length > 0 ? (
              <Notice tone="danger" title="Sending is blocked">
                <ul className="list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                <p className="mt-2">You can still download the PDF or record a manual mailing from the <Link className="underline" href={`/packets/${packet.id}`}>packet page</Link>.</p>
              </Notice>
            ) : (
              <ActionForm action={submitMailingAction} className="space-y-2" testId="wizard-send">
                <input type="hidden" name="packet_id" value={packet.id} />
                <input type="hidden" name="packet_hash" value={packet.packet_hash} />
                <input type="hidden" name="return_to" value="/test-center/wizard?mailing=:mailing" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" required /> I reviewed the recipient.</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" required /> I reviewed the PDF.</label>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" name="acknowledge_charges" required /> I understand this may result in a physical mailing and charge.
                </label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm_final" required /> Send this test mailing now.</label>
                <SubmitButton className="btn btn-danger" pendingLabel="Submitting — do not close…" testId="send-test-mail">SEND TEST MAIL</SubmitButton>
              </ActionForm>
            )}
          </Step>
        )}
      </div>
    );
  }

  // Steps 2–3
  if (clientId && caseId) {
    const client = await ctx.store.get("clients", clientId);
    if (!client?.is_test_record) return <div>{header}<Notice tone="danger">Select a TEST RECORD first.</Notice></div>;
    const settings = await getSettings(ctx);
    return (
      <div className="max-w-3xl space-y-4">
        {header}
        <Step n={1} title="Select test record" done>
          <p className="text-sm">{client.full_name} <Badge tone="amber">TEST RECORD</Badge></p>
        </Step>
        <ActionForm action={wizardCreateLetterAction} className="space-y-4" testId="wizard-letter">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="case_id" value={caseId} />
          <Step n={2} title="Enter YOUR OWN test recipient information">
            <p className="mb-3 text-sm text-soft">Use your own name and address. Never a real consumer or a company.</p>
            <AddressFields prefix="recipient" nameLabel="Your name" requireAll />
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="own_address" required /> This recipient is me, at my own address.
            </label>
          </Step>
          <Step n={3} title="Test letter">
            <p className="mb-2 text-sm text-soft">Sender / return address</p>
            <AddressFields prefix="sender" defaults={settings.return_address} nameLabel="Sender name" requireAll />
            <Field label="Letter text (optional — leave blank for the standard test letter)" className="mt-3"
              hint="The standard text reads: LETTERSTREAM INTEGRATION TEST — This is a system integration test generated from Consumer Desk. — plus the date, a unique Test ID, sender and recipient.">
              <textarea className="textarea !min-h-[100px]" name="body" />
            </Field>
          </Step>
          <SubmitButton pendingLabel="Generating PDF…" testId="wizard-generate">Generate the actual PDF (Step 4)</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  // Step 1
  const testClients = await ctx.store.list("clients", { is_test_record: true });
  const cases = await ctx.store.list("cases");
  return (
    <div className="max-w-3xl space-y-4">
      {header}
      <Step n={1} title="Select TEST RECORD">
        {testClients.length > 0 && (
          <ul className="mb-4 space-y-2">
            {testClients.map((c) => {
              const k = cases.find((x) => x.client_id === c.id && x.status !== "closed");
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3">
                  <span>{c.full_name}</span>
                  {k ? (
                    <Link className="btn btn-sm btn-primary" href={`/test-center/wizard?client=${c.id}&case=${k.id}`}>Use this test record</Link>
                  ) : (
                    <Link className="btn btn-sm" href={`/clients/${c.id}/cases/new`}>Add a case first</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ActionForm action={createTestRecordAction} className="space-y-3" testId="wizard-test-record">
          <Field label="Your name (creates a new TEST RECORD — not a client)">
            <input className="input" name="full_name" required defaultValue={ctx.isDemo ? "Demo Owner (fictional)" : ""} />
          </Field>
          <SubmitButton>Create TEST RECORD</SubmitButton>
        </ActionForm>
      </Step>
    </div>
  );
}
