import Link from "next/link";
import { notFound } from "next/navigation";
import { addNoteAction, archiveClientAction, deleteClientAction } from "@/app/actions/records";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { UploadForm } from "@/components/upload-form";
import { AddressBlock, Badge, Card, DefinitionList, EmptyState, Field, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import {
  CASE_STATUS,
  DELIVERY_STATUS,
  DOCUMENT_CATEGORY,
  EVENT_SOURCE,
  LETTER_STATUS,
  MAILING_STATUS,
  RECORD_ORIGIN,
  RESPONSE_STATUS,
  formatDate,
  formatDateTime,
} from "@/lib/labels";
import { requireOwner } from "@/server/context";
import { getClientBundle } from "@/server/services/clients";
import { clientTimeline } from "@/server/services/timeline";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["cases", "Cases"],
  ["documents", "Documents"],
  ["letters", "Letters & Mailings"],
  ["notes", "Notes"],
  ["timeline", "Timeline"],
] as const;

export default async function ClientDetail(props: PageProps<"/clients/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await requireOwner();
  const bundle = await getClientBundle(ctx, id).catch(() => null);
  if (!bundle) notFound();
  const { client, cases, notes, documents, letters, mailings, responses, followUps, packets } = bundle;
  const tab = (typeof sp.tab === "string" && TABS.some(([k]) => k === sp.tab) ? sp.tab : "overview") as (typeof TABS)[number][0];
  const caseTitle = new Map(cases.map((c) => [c.id, c.title]));
  const tz = ctx.timezone;

  return (
    <div>
      <PageHeader
        eyebrow={ctx.isDemo ? "Fictional demo data" : "Client"}
        title={client.full_name}
        description={
          <span className="flex flex-wrap gap-2">
            {client.is_test_record && <Badge tone="amber">TEST RECORD</Badge>}
            {client.archived_at && <Badge>Archived {formatDate(client.archived_at, tz)}</Badge>}
            {client.tags.map((t) => (
              <Badge key={t} tone="blue">
                {t}
              </Badge>
            ))}
          </span>
        }
        actions={
          <>
            <Link href={`/clients/${client.id}/cases/new`} className="btn btn-primary" data-testid="new-case">
              New case
            </Link>
            <Link href={`/letters/new?client=${client.id}`} className="btn">
              New letter
            </Link>
            <Link href={`/clients/${client.id}/edit`} className="btn">
              Edit
            </Link>
          </>
        }
      />
      {sp.created === "1" && <p className="notice notice-ok mb-4">Client saved.</p>}
      <Tabs current={tab} tabs={TABS.map(([key, label]) => ({ key, label, href: `/clients/${client.id}?tab=${key}` }))} />

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Contact" className="lg:col-span-2">
            <DefinitionList
              items={[
                ["Email", client.email],
                ["Phone", client.phone],
                ["Preferred contact", client.preferred_contact],
                [
                  "Mailing address",
                  <AddressBlock
                    key="a"
                    lines={[client.address_line1, client.address_line2, [client.city, [client.state, client.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean) as string[]}
                  />,
                ],
                ["Created", formatDateTime(client.created_at, tz)],
                ["Updated", formatDateTime(client.updated_at, tz)],
              ]}
            />
            {client.notes && <p className="mt-4 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-soft">{client.notes}</p>}
          </Card>
          <Card title="At a glance">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-muted">Open cases</span><span>{cases.filter((c) => c.status !== "closed").length}</span></li>
              <li className="flex justify-between"><span className="text-muted">Documents</span><span>{documents.length}</span></li>
              <li className="flex justify-between"><span className="text-muted">Letters</span><span>{letters.length}</span></li>
              <li className="flex justify-between"><span className="text-muted">Mailings</span><span>{mailings.length}</span></li>
              <li className="flex justify-between"><span className="text-muted">Responses</span><span>{responses.length}</span></li>
              <li className="flex justify-between"><span className="text-muted">Open follow-ups</span><span>{followUps.filter((f) => !f.completed_at).length}</span></li>
            </ul>
          </Card>
          <Card title="Export & archive" className="lg:col-span-3">
            <div className="flex flex-wrap items-start gap-3">
              <form method="post" action={`/api/exports/client/${client.id}`}>
                <button className="btn" type="submit">Export client records (JSON)</button>
              </form>
              <ActionForm action={archiveClientAction}>
                <input type="hidden" name="id" value={client.id} />
                <input type="hidden" name="archived" value={client.archived_at ? "false" : "true"} />
                <SubmitButton className="btn">{client.archived_at ? "Restore from archive" : "Archive client"}</SubmitButton>
              </ActionForm>
            </div>
            <details className="mt-5 rounded-xl border border-danger/30 p-4">
              <summary className="cursor-pointer font-semibold text-danger">Delete client permanently…</summary>
              <ActionForm action={deleteClientAction} className="mt-3 space-y-3">
                <p className="text-sm text-soft">
                  Deletes this client, their cases, letters, notes, follow-ups and stored files. Clients with mailing records cannot be
                  deleted (mailing history is kept) — archive them instead. This cannot be undone.
                </p>
                <input type="hidden" name="id" value={client.id} />
                <Field label={`Type the full name to confirm: ${client.full_name}`}>
                  <input className="input" name="confirm_name" autoComplete="off" required />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="understand" required /> I understand this is permanent.
                </label>
                <SubmitButton className="btn btn-danger" pendingLabel="Deleting…">Delete permanently</SubmitButton>
              </ActionForm>
            </details>
          </Card>
        </div>
      )}

      {tab === "cases" && (
        <div className="space-y-4">
          {cases.length === 0 && (
            <Card>
              <EmptyState title="No cases yet" action={<Link href={`/clients/${client.id}/cases/new`} className="btn btn-primary btn-sm">Create case</Link>} />
            </Card>
          )}
          {cases.map((c) => {
            const caseLetters = letters.filter((l) => l.case_id === c.id);
            const caseMailings = mailings.filter((m) => m.case_id === c.id);
            const caseDocs = documents.filter((d) => d.case_id === c.id);
            return (
              <Card
                key={c.id}
                id={`case-${c.id}`}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {c.title} <StatusBadge map={CASE_STATUS} value={c.status} />
                  </span>
                }
                actions={
                  <>
                    <Link className="btn btn-sm" href={`/letters/new?client=${client.id}&case=${c.id}`}>New letter</Link>
                    <Link className="btn btn-sm" href={`/cases/${c.id}/edit`}>Edit case</Link>
                  </>
                }
              >
                <DefinitionList
                  items={[
                    ["Category", c.category],
                    ["Organization / recipient", c.organization || "—"],
                    ["Account reference", c.account_last4 ? `ending in ${c.account_last4}` : "—"],
                    ["Next action", c.next_action || "—"],
                    ["Reminder date", formatDate(c.reminder_date)],
                    [
                      "Authorization",
                      c.acting_for_another
                        ? c.authorization_on_file
                          ? `On file. ${c.authorization_notes}`
                          : "Acting for another person — authorization NOT recorded"
                        : "Not acting for another person",
                    ],
                    ["Supporting documents", caseDocs.length],
                    ["Letters / mailings", `${caseLetters.length} / ${caseMailings.length}`],
                  ]}
                />
                {c.description && <p className="mt-4 whitespace-pre-wrap text-sm text-soft">{c.description}</p>}
                {c.outcome && (
                  <p className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                    <strong>Outcome:</strong> {c.outcome}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === "documents" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card title="Documents" className="lg:col-span-3">
            {documents.length === 0 ? (
              <EmptyState title="No documents">Upload supporting evidence, correspondence, authorizations or responses.</EmptyState>
            ) : (
              <ul className="divide-y divide-white/5">
                {documents.map((d) => (
                  <li key={d.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate font-medium hover:text-cyan">
                        {d.original_filename}
                      </a>
                      <span className="text-xs text-muted">
                        {DOCUMENT_CATEGORY[d.category]} · {caseTitle.get(d.case_id ?? "") ?? "No case"} · {d.page_count ?? "?"} page(s) ·{" "}
                        {(d.size_bytes / 1024).toFixed(0)} KB
                      </span>
                    </span>
                    <span className="text-xs text-soft">{formatDate(d.created_at, tz)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Upload" className="lg:col-span-2">
            <UploadForm
              clients={[{ id: client.id, name: client.full_name }]}
              cases={cases.map((c) => ({ id: c.id, clientId: c.client_id, title: c.title }))}
              isDemo={ctx.isDemo}
              defaultClientId={client.id}
              returnTo={`/clients/${client.id}?tab=documents`}
            />
          </Card>
        </div>
      )}

      {tab === "letters" && (
        <div className="space-y-4">
          <Card title="Letters" actions={<Link href={`/letters/new?client=${client.id}`} className="btn btn-sm btn-primary">New letter</Link>}>
            {letters.length === 0 ? (
              <EmptyState title="No letters yet" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Letter</th><th>Case</th><th>Recipient</th><th>Document status</th><th>Updated</th></tr>
                  </thead>
                  <tbody>
                    {letters.map((l) => (
                      <tr key={l.id}>
                        <td><Link className="font-medium hover:text-cyan" href={`/letters/${l.id}`}>{l.title}</Link></td>
                        <td className="text-soft">{caseTitle.get(l.case_id)}</td>
                        <td className="text-soft">{l.recipient_name || "—"}</td>
                        <td><StatusBadge map={LETTER_STATUS} value={l.status} /></td>
                        <td className="text-soft">{formatDate(l.updated_at, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Mailings">
            {mailings.length === 0 ? (
              <EmptyState title="No mailings yet" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Recipient</th><th>Case</th><th>Mailing</th><th>Delivery</th><th>Response</th><th>Origin</th><th>Submitted</th></tr>
                  </thead>
                  <tbody>
                    {mailings.map((m) => (
                      <tr key={m.id}>
                        <td><Link className="font-medium hover:text-cyan" href={`/mailings/${m.id}`}>{m.recipient_snapshot.name ?? "—"}</Link></td>
                        <td className="text-soft">{caseTitle.get(m.case_id)}</td>
                        <td><StatusBadge map={MAILING_STATUS} value={m.mailing_status} /></td>
                        <td><StatusBadge map={DELIVERY_STATUS} value={m.delivery_status} /></td>
                        <td><StatusBadge map={RESPONSE_STATUS} value={m.response_status} /></td>
                        <td><StatusBadge map={RECORD_ORIGIN} value={m.record_origin} /></td>
                        <td className="text-soft">{formatDate(m.submitted_at, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">{packets.length} packet version(s) generated for this client.</p>
          </Card>
        </div>
      )}

      {tab === "notes" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card title="Coaching & session notes" className="lg:col-span-3">
            {notes.length === 0 ? (
              <EmptyState title="No notes yet" />
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-1 text-xs text-muted">
                      {n.session_date ? `Session ${formatDate(n.session_date)} · ` : ""}
                      {caseTitle.get(n.case_id ?? "") ?? "General"} · added {formatDateTime(n.created_at, tz)}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Add note" className="lg:col-span-2">
            <ActionForm action={addNoteAction} className="space-y-3">
              <input type="hidden" name="client_id" value={client.id} />
              <Field label="Case">
                <select className="select" name="case_id">
                  <option value="">General (no case)</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Session date">
                <input className="input" type="date" name="session_date" />
              </Field>
              <Field label="Note *">
                <textarea className="textarea" name="body" required />
              </Field>
              <SubmitButton pendingLabel="Saving…">Add note</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      {tab === "timeline" && <Timeline clientId={client.id} timezone={tz} />}
    </div>
  );
}

async function Timeline({ clientId, timezone }: { clientId: string; timezone: string }) {
  const ctx = await requireOwner();
  const entries = await clientTimeline(ctx, clientId);
  return (
    <Card title="Client timeline">
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {Object.entries(EVENT_SOURCE).map(([k, [label, tone]]) => (
          <Badge key={k} tone={tone}>{label}</Badge>
        ))}
      </div>
      {entries.length === 0 ? (
        <EmptyState title="No events yet" />
      ) : (
        <ol className="relative ml-3 border-l border-accent/30" data-testid="timeline">
          {entries.map((e) => {
            const external = e.source === "provider" || e.source === "simulation";
            return (
              <li key={e.id} className="mb-5 ml-5">
                <span
                  className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ${
                    e.source === "provider" ? "bg-cyan shadow-[0_0_12px_rgba(53,231,255,0.9)]" : e.source === "simulation" ? "bg-violet" : e.source === "owner" ? "bg-accent" : "bg-muted"
                  }`}
                  aria-hidden
                />
                <div className={`rounded-xl border p-3 ${external ? "border-cyan/30 bg-cyan/5" : "border-white/10 bg-black/20"}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <time className="font-semibold text-ink" dateTime={e.at}>{formatDateTime(e.at, timezone)}</time>
                    <StatusBadge map={EVENT_SOURCE} value={e.source} />
                    {e.caseTitle && <span className="text-muted">Case: {e.caseTitle}</span>}
                  </div>
                  <p className="mt-1 text-sm">{e.summary}</p>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                    <span>{e.action}</span>
                    {e.href && (
                      <a href={e.href} className="text-cyan hover:underline">
                        Open {e.recordType.replace(/_/g, " ")}
                      </a>
                    )}
                    {e.notes && <span>Notes: {e.notes}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
