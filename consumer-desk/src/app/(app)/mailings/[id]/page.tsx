import Link from "next/link";
import { notFound } from "next/navigation";
import { createDraftFromPacketAction } from "@/app/actions/letters";
import { manualUpdateAction, reconcileAction, refreshStatusAction, simulateEventAction } from "@/app/actions/mailings";
import { createFollowUpAction } from "@/app/actions/responses";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AddressBlock, Badge, Card, DefinitionList, Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import {
  DELIVERY_STATUS,
  EVENT_SOURCE,
  FOLLOW_UP_KIND,
  MAILING_STATUS,
  RECORD_ORIGIN,
  RESPONSE_STATUS,
  SERVICE,
  formatAddress,
  formatDate,
  formatDateTime,
  money,
} from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { SIMULATED_EVENTS, getMailingBundle } from "@/server/services/mailings";
import { addDays, todayIn } from "@/server/services/time";

export const dynamic = "force-dynamic";
// Mail submission waits up to 30 s for the provider; allow headroom on serverless hosts.
export const maxDuration = 60;

const OUTCOME: Record<string, [string, "ok" | "warn" | "danger" | "info"]> = {
  accepted: ["Accepted by the provider. This is not the same as mailed — watch for production and mailing events.", "ok"],
  rejected: ["The submission was rejected or not sent. Nothing was accepted. Create a new mailing from this packet if you want to try again.", "danger"],
  unknown: ["Submission outcome unknown. It was NOT resent. Check the provider account and record what you find below.", "danger"],
  duplicate: ["This packet already had a mailing record — nothing was sent again.", "warn"],
};

export default async function MailingDetail(props: PageProps<"/mailings/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await requireOwner();
  const bundle = await getMailingBundle(ctx, id);
  if (!bundle) notFound();
  const { mailing: m, packet, letter, client, kase, events, responses, followUps, audit } = bundle;
  const tz = ctx.timezone;
  const outcome = typeof sp.outcome === "string" ? OUTCOME[sp.outcome] : null;
  const deliveryEvents = events.filter((e) => e.delivery_status);

  return (
    <div>
      <PageHeader
        eyebrow={`${client.full_name} · ${kase.title}`}
        title={`Mailing to ${m.recipient_snapshot.name ?? "recipient"}`}
        description={
          <span className="flex flex-wrap gap-2">
            <StatusBadge map={MAILING_STATUS} value={m.mailing_status} prefix="Mailing: " />
            <StatusBadge map={DELIVERY_STATUS} value={m.delivery_status} prefix="Delivery: " />
            <StatusBadge map={RESPONSE_STATUS} value={m.response_status} prefix="Response: " />
            <StatusBadge map={RECORD_ORIGIN} value={m.record_origin} />
            {client.is_test_record && <Badge tone="amber">TEST RECORD</Badge>}
            {ctx.isDemo && <Badge tone="violet">FICTIONAL DEMO DATA</Badge>}
          </span>
        }
        actions={
          <>
            <Link className="btn" href={`/packets/${packet.id}`}>View packet</Link>
            <a className="btn" href={`/api/packets/${packet.id}/pdf?download=1`}>Download packet</a>
            <Link className="btn btn-primary" href={`/responses/new?mailing=${m.id}`} data-testid="add-response">Add response</Link>
          </>
        }
      />

      {outcome && (
        <div className="mb-4" data-testid="submit-outcome">
          <Notice tone={outcome[1]}>{outcome[0]}</Notice>
        </div>
      )}
      {m.unresolved_condition && (
        <div className="mb-4">
          <Notice tone="warn" title="Unresolved condition">{m.unresolved_condition}</Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Mailing record" lit>
            <DefinitionList
              items={[
                ["Client", <Link key="c" href={`/clients/${client.id}`} className="text-cyan hover:underline">{client.full_name}</Link>],
                ["Case", kase.title],
                ["Recipient", <AddressBlock key="r" lines={formatAddress(m.recipient_snapshot)} />],
                ["Letter", letter ? <Link key="l" href={`/letters/${letter.id}`} className="text-cyan hover:underline">{letter.title}</Link> : "—"],
                ["Attachments", packet.attachments_snapshot.length ? packet.attachments_snapshot.map((a) => a.original_filename).join(", ") : "None"],
                ["Pages", m.page_count],
                ["Mailing method", `${SERVICE[m.service] ?? m.service}${m.return_receipt ? " + return receipt" : ""}`],
                ["Provider / mode", `${m.provider} · ${m.mail_mode}`],
                ["Provider reference", m.provider_reference ?? "—"],
                ["Provider status (as reported)", <code key="p" className="text-xs">{m.provider_status_raw ?? "—"}</code>],
                [
                  "Tracking number",
                  m.tracking_number ?? (m.tracking_supported ? "Not yet reported" : "Not available for this service"),
                ],
                ["Awaiting funding", m.awaiting_funding ? <Badge key="f" tone="amber">Yes — not produced until paid</Badge> : "No"],
                ["Quote at approval", m.quote_cents !== null ? money(m.quote_cents, m.cost_currency ?? "USD") : "Not available"],
                ["Actual cost", m.actual_cost_cents !== null ? money(m.actual_cost_cents, m.cost_currency ?? "USD") : "Not reported"],
                ["Last status refresh", formatDateTime(m.last_status_refresh_at, tz)],
                ["Last error", m.last_error ?? "—"],
              ]}
            />
          </Card>

          <Card title="Milestones">
            <ol className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Packet created", packet.created_at],
                ["Packet approved", packet.approved_at],
                ["Submission started", m.submission_started_at],
                ["Submitted", m.submitted_at],
                ["Provider accepted", m.accepted_at],
                ["Reported mailed", m.mailed_at],
                ["Reported delivered", m.delivered_at],
                ["First response recorded", responses.at(-1)?.created_at ?? null],
              ].map(([label, at]) => (
                <li key={label as string} className={`rounded-xl border p-2.5 ${at ? "border-cyan/30 bg-cyan/5" : "border-white/10 bg-black/20 text-muted"}`}>
                  <div className="text-xs uppercase tracking-wider">{label}</div>
                  <div className="font-medium">{formatDateTime(at as string | null, tz)}</div>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Provider & status events">
            {events.length === 0 ? (
              <p className="text-sm text-muted">No events recorded.</p>
            ) : (
              <ol className="space-y-2" data-testid="mailing-events">
                {events.map((e) => (
                  <li key={e.id} className={`rounded-xl border p-3 text-sm ${e.source === "provider" ? "border-cyan/40 bg-cyan/5" : "border-white/10 bg-black/20"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge map={EVENT_SOURCE} value={e.source} />
                      <span className="text-muted">recorded {formatDateTime(e.recorded_at, tz)}</span>
                      {e.occurred_at && <span className="text-muted">· occurred {formatDateTime(e.occurred_at, tz)}</span>}
                      {e.provider_status_raw && <code className="text-soft">{e.provider_status_raw}</code>}
                    </div>
                    <p className="mt-1">{e.description}</p>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-xs text-muted">
              Delivery events: {deliveryEvents.length ? deliveryEvents.length : m.tracking_supported ? "none reported yet" : "Not available for this service"}.
              Delivery, responses and case outcome are tracked separately.
            </p>
          </Card>

          <Card title="Activity log">
            <ul className="space-y-1.5 text-sm">
              {audit.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-2">
                  <span className="text-xs text-muted">{formatDateTime(a.occurred_at, tz)}</span>
                  <StatusBadge map={EVENT_SOURCE} value={a.source} />
                  <span>{a.summary}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Status">
            <div className="space-y-3">
              <ActionForm action={refreshStatusAction}>
                <input type="hidden" name="mailing_id" value={m.id} />
                <SubmitButton className="btn w-full" pendingLabel="Refreshing…" testId="refresh-status">Refresh status</SubmitButton>
              </ActionForm>
              <p className="text-xs text-muted">Automatic synchronization is not configured. Status only updates when you refresh.</p>
            </div>
          </Card>

          {m.provider === "mock" && !["submission_unknown", "failed", "cancelled", "submitting"].includes(m.mailing_status) && (
            <Card title="Record simulated event">
              <p className="mb-3 text-xs text-muted">Mock provider only. Advances the simulation one step; every event is labelled “Simulated”.</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(SIMULATED_EVENTS).map(([key, def]) => (
                  <ActionForm key={key} action={simulateEventAction}>
                    <input type="hidden" name="mailing_id" value={m.id} />
                    <input type="hidden" name="event" value={key} />
                    <SubmitButton className="btn btn-sm" testId={`simulate-${key}`}>{def.label}</SubmitButton>
                  </ActionForm>
                ))}
              </div>
            </Card>
          )}

          {m.mailing_status === "submission_unknown" && (
            <Card title="Reconcile unknown submission" lit>
              <p className="mb-3 text-sm text-soft">
                Check your provider account. Record what you find — the app never resends automatically.
              </p>
              <ActionForm action={reconcileAction} className="space-y-3">
                <input type="hidden" name="mailing_id" value={m.id} />
                <Field label="What did the provider show?">
                  <select className="select" name="resolution">
                    <option value="confirmed_accepted">It was received (enter its reference)</option>
                    <option value="confirmed_not_received">It was not received</option>
                  </select>
                </Field>
                <Field label="Provider reference"><input className="input" name="provider_reference" /></Field>
                <Field label="Notes"><input className="input" name="notes" /></Field>
                <SubmitButton className="btn btn-warn">Record reconciliation</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {m.provider === "manual" && (
            <Card title="Manual status update">
              <ActionForm action={manualUpdateAction} className="space-y-3">
                <input type="hidden" name="mailing_id" value={m.id} />
                <Field label="Mailing status">
                  <select className="select" name="mailing_status" defaultValue="">
                    <option value="">No change</option>
                    {Object.entries(MAILING_STATUS).filter(([k]) => !["submitting", "not_submitted"].includes(k)).map(([k, [l]]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Delivery status">
                  <select className="select" name="delivery_status" defaultValue="">
                    <option value="">No change</option>
                    {Object.entries(DELIVERY_STATUS).map(([k, [l]]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Tracking number"><input className="input" name="tracking_number" defaultValue={m.tracking_number ?? ""} /></Field>
                <Field label="Note"><input className="input" name="note" /></Field>
                <SubmitButton className="btn">Save manual update</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title="Responses">
            {responses.length === 0 ? (
              <p className="text-sm text-muted">No response recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {responses.map((r) => (
                  <li key={r.id}>
                    <Link href={`/responses/${r.id}`} className="flex items-center justify-between gap-2 hover:text-cyan">
                      <span>{formatDate(r.received_date)} · {r.sender_name || "Sender not recorded"}</span>
                      <StatusBadge map={RESPONSE_STATUS} value={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Follow-ups">
            <ul className="mb-3 space-y-1.5 text-sm">
              {followUps.map((f) => (
                <li key={f.id} className="flex justify-between gap-2">
                  <span className={f.completed_at ? "line-through opacity-60" : ""}>{f.title}</span>
                  <span className="text-xs text-muted">{formatDate(f.due_date)}</span>
                </li>
              ))}
            </ul>
            <ActionForm action={createFollowUpAction} className="space-y-2">
              <input type="hidden" name="client_id" value={m.client_id} />
              <input type="hidden" name="case_id" value={m.case_id} />
              <input type="hidden" name="mailing_id" value={m.id} />
              <Field label="Type">
                <select className="select" name="kind" defaultValue="check_delivery">
                  {Object.entries(FOLLOW_UP_KIND).map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Title"><input className="input" name="title" required defaultValue="Check delivery status" /></Field>
              <Field label="Due date" hint="Your own reminder — not a legal deadline.">
                <input className="input" type="date" name="due_date" required defaultValue={addDays(todayIn(tz), 7)} />
              </Field>
              <SubmitButton className="btn btn-sm">Create follow-up</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Mail again?">
            <ActionForm action={createDraftFromPacketAction}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <SubmitButton className="btn w-full" testId="new-from-packet">Create new mailing from this packet</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">Creates a new draft that needs a new review and approval. Nothing is resubmitted.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
