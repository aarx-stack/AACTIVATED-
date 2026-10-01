"use client";

import { useActionState, useRef, useState } from "react";
import { saveLetterAction } from "@/app/actions/letters";
import type { ActionState } from "@/lib/action-state";
import { SubmitButton } from "./action-form";

export interface EditorDoc {
  id: string;
  filename: string;
  category: string;
  mime: string;
  pages: number | null;
}

export interface EditorAddress {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface EditorLetter {
  id: string;
  title: string;
  letter_type: string;
  body: string;
  recipient_name: string;
  recipient_address: EditorAddress;
  sender_address: EditorAddress;
  service: string;
  return_receipt: boolean;
  expects_response: boolean;
}

function AddressInputs({ prefix, value, onChange }: { prefix: string; value: EditorAddress; onChange: (v: EditorAddress) => void }) {
  const set = (k: keyof EditorAddress) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-6 gap-2">
      <input className="input col-span-6" name={`${prefix}_name`} placeholder="Name" value={value.name ?? ""} onChange={set("name")} aria-label={`${prefix} name`} />
      <input className="input col-span-6 sm:col-span-4" name={`${prefix}_line1`} placeholder="Street address" value={value.line1 ?? ""} onChange={set("line1")} aria-label={`${prefix} street`} />
      <input className="input col-span-6 sm:col-span-2" name={`${prefix}_line2`} placeholder="Apt / suite / attn" value={value.line2 ?? ""} onChange={set("line2")} aria-label={`${prefix} line 2`} />
      <input className="input col-span-3" name={`${prefix}_city`} placeholder="City" value={value.city ?? ""} onChange={set("city")} aria-label={`${prefix} city`} />
      <input className="input col-span-1" name={`${prefix}_state`} placeholder="ST" value={value.state ?? ""} onChange={set("state")} aria-label={`${prefix} state`} />
      <input className="input col-span-2" name={`${prefix}_postal_code`} placeholder="ZIP" value={value.postal_code ?? ""} onChange={set("postal_code")} aria-label={`${prefix} ZIP`} />
      <input type="hidden" name={`${prefix}_country`} value={value.country || "US"} />
    </div>
  );
}

export function LetterEditor({
  letter,
  attachedIds,
  documents,
  insertFields,
}: {
  letter: EditorLetter;
  attachedIds: string[];
  documents: EditorDoc[];
  insertFields: { label: string; value: string }[];
}) {
  const [state, action] = useActionState(saveLetterAction, { status: "idle", message: "" } as ActionState);
  const [body, setBody] = useState(letter.body);
  const [recipient, setRecipient] = useState<EditorAddress>({ ...letter.recipient_address });
  const [sender, setSender] = useState<EditorAddress>({ ...letter.sender_address });
  const [service, setService] = useState(letter.service);
  const [order, setOrder] = useState<string[]>(attachedIds);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const placeholders = [...new Set([...body.matchAll(/\[\[([^\]]{1,200})\]\]/g)].map((m) => m[1]))];

  const insert = (text: string) => {
    const el = bodyRef.current;
    if (!el) return setBody((b) => b + text);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const move = (id: string, delta: number) =>
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const copy = [...o];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const toggle = (id: string) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const docById = new Map(documents.map((d) => [d.id, d]));

  return (
    <form action={action} className="grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="letter-editor">
      <input type="hidden" name="id" value={letter.id} />
      <input type="hidden" name="attachments" value={order.join(",")} />
      <div className="space-y-4 xl:col-span-2">
        {state.status === "error" && (
          <div className="notice notice-danger" role="alert" data-testid="form-error">
            {state.message}
          </div>
        )}
        {state.status === "success" && (
          <div className="notice notice-ok" role="status" data-testid="form-success">
            {state.message}
          </div>
        )}
        <section className="glass p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="label">Letter title (internal)</span>
              <input className="input" name="title" defaultValue={letter.title} required />
            </label>
            <label className="block">
              <span className="label">Letter type</span>
              <input className="input" name="letter_type" defaultValue={letter.letter_type} />
            </label>
          </div>
        </section>

        <section className="glass p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Letter body</h2>
            <span className="text-xs text-muted">Write the facts yourself. Nothing is generated or added automatically.</span>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Insert client fields">
            {insertFields.map((f) => (
              <button key={f.label} type="button" className="btn btn-sm" onClick={() => insert(f.value)} disabled={!f.value} title={f.value || "No value on record"}>
                + {f.label}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            className="textarea min-h-[420px] font-[450]"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            data-testid="letter-body"
            aria-label="Letter body"
          />
          {placeholders.length > 0 && (
            <p className="notice notice-warn mt-2 text-xs">
              Replace {placeholders.length} placeholder{placeholders.length === 1 ? "" : "s"} before preparing the packet:{" "}
              {placeholders.map((p) => `[[${p}]]`).join(", ")}
            </p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className="glass p-5">
          <h2 className="mb-2 font-semibold">Recipient</h2>
          <p className="mb-2 text-xs text-muted">Enter and verify the address yourself. No bureau or company addresses are built in.</p>
          {/* The "recipient_name" input (prefix + _name) is the recipient name used on the letter. */}
          <AddressInputs prefix="recipient" value={recipient} onChange={setRecipient} />
        </section>
        <section className="glass p-5">
          <h2 className="mb-2 font-semibold">Sender / return address</h2>
          <AddressInputs prefix="sender" value={sender} onChange={setSender} />
        </section>
        <section className="glass p-5">
          <h2 className="mb-2 font-semibold">Mailing options</h2>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="service" value="first_class" checked={service === "first_class"} onChange={() => setService("first_class")} /> First-Class
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="service" value="certified" checked={service === "certified"} onChange={() => setService("certified")} /> Certified
            </label>
            <label className={`flex items-center gap-2 pl-6 ${service !== "certified" ? "opacity-40" : ""}`}>
              <input type="checkbox" name="return_receipt" defaultChecked={letter.return_receipt} disabled={service !== "certified"} /> Return receipt
            </label>
            <label className="flex items-center gap-2 border-t border-white/10 pt-2">
              <input type="checkbox" name="expects_response" defaultChecked={letter.expects_response} /> I expect a written response
            </label>
            <p className="text-xs text-muted">Availability is confirmed against the active provider before sending.</p>
          </div>
        </section>
        <section className="glass p-5">
          <h2 className="mb-2 font-semibold">Attachments (in mailing order)</h2>
          {documents.length === 0 ? (
            <p className="text-sm text-muted">This client has no uploaded documents.</p>
          ) : (
            <>
              <ol className="mb-3 space-y-1.5" data-testid="attachment-order">
                {order.map((id, i) => {
                  const d = docById.get(id);
                  if (!d) return null;
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-lg border border-cyan/30 bg-cyan/5 px-2 py-1.5 text-sm">
                      <span className="w-5 text-xs text-muted">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{d.filename}</span>
                      <button type="button" className="btn btn-sm" onClick={() => move(id, -1)} aria-label={`Move ${d.filename} up`} disabled={i === 0}>↑</button>
                      <button type="button" className="btn btn-sm" onClick={() => move(id, 1)} aria-label={`Move ${d.filename} down`} disabled={i === order.length - 1}>↓</button>
                      <button type="button" className="btn btn-sm" onClick={() => toggle(id)} aria-label={`Remove ${d.filename}`}>✕</button>
                    </li>
                  );
                })}
              </ol>
              <ul className="space-y-1 text-sm">
                {documents
                  .filter((d) => !order.includes(d.id))
                  .map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-soft">
                        {d.filename} <span className="text-xs text-muted">({d.pages ?? "?"} p)</span>
                      </span>
                      <button type="button" className="btn btn-sm" onClick={() => toggle(d.id)} data-testid={`attach-${d.id}`}>
                        Attach
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>
        <div className="glass glass-lit sticky bottom-3 flex flex-col gap-2 p-4">
          <SubmitButton name="intent" value="save" className="btn" pendingLabel="Saving…" testId="save-draft">
            Save draft
          </SubmitButton>
          <SubmitButton name="intent" value="prepare" pendingLabel="Building packet…" testId="prepare-packet">
            Save &amp; preview complete packet
          </SubmitButton>
          <a className="btn btn-sm" href={`/api/letters/${letter.id}/pdf`} target="_blank" rel="noreferrer">
            Generate letter PDF (saved draft)
          </a>
          <p className="text-xs text-muted">Editing anything invalidates an earlier packet approval.</p>
        </div>
      </div>
    </form>
  );
}
