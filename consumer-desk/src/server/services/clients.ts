import { z } from "zod";
import type { CaseRow, ClientRow } from "../types";
import { CASE_STATUSES, PREFERRED_CONTACTS } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError, assertFound } from "./errors";
import { nowIso } from "./time";
import {
  assertNoSensitiveNumbers,
  nullableText,
  optionalDate,
  optionalText,
  parse,
  requiredText,
  uuid,
} from "./validation";

// ---------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------

const clientSchema = z.object({
  full_name: requiredText(200, "Full name"),
  email: nullableText(320).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email."),
  phone: nullableText(40),
  address_line1: nullableText(200),
  address_line2: nullableText(200),
  city: nullableText(100),
  state: nullableText(50),
  postal_code: nullableText(20),
  country: optionalText(60).transform((s) => s || "US"),
  preferred_contact: z.enum(PREFERRED_CONTACTS).default("email"),
  notes: optionalText(20000),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : (v ?? "").split(","))
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
    ),
  is_test_record: z.boolean().optional().default(false),
});
export type ClientInput = z.input<typeof clientSchema>;

export async function createClient(ctx: Ctx, input: ClientInput): Promise<ClientRow> {
  const data = parse(clientSchema, input);
  assertNoSensitiveNumbers({ notes: data.notes });
  const row = await ctx.store.insert("clients", { ...data, owner_id: ctx.owner.id, archived_at: null });
  await recordAudit(ctx, {
    action: "client.created",
    record_type: "client",
    record_id: row.id,
    client_id: row.id,
    summary: row.is_test_record ? "Test record created" : "Client created",
  });
  return row;
}

export async function updateClient(ctx: Ctx, id: string, input: ClientInput): Promise<ClientRow> {
  parse(uuid, id);
  const existing = assertFound(await ctx.store.get("clients", id), "Client");
  const data = parse(clientSchema, input);
  assertNoSensitiveNumbers({ notes: data.notes });
  const row = assertFound(await ctx.store.update("clients", existing.id, data), "Client");
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
    (k) => JSON.stringify(existing[k]) !== JSON.stringify(row[k]),
  );
  await recordAudit(ctx, {
    action: "client.edited",
    record_type: "client",
    record_id: id,
    client_id: id,
    summary: "Client details edited",
    metadata: { fields: changed },
  });
  return row;
}

export async function setClientArchived(ctx: Ctx, id: string, archived: boolean): Promise<void> {
  parse(uuid, id);
  assertFound(await ctx.store.get("clients", id), "Client");
  await ctx.store.update("clients", id, { archived_at: archived ? nowIso() : null });
  await recordAudit(ctx, {
    action: archived ? "client.archived" : "client.unarchived",
    record_type: "client",
    record_id: id,
    client_id: id,
    summary: archived ? "Client archived" : "Client restored from archive",
  });
}

/**
 * Permanently deletes a client and their cases, letters, documents and files. Requires the
 * exact client name as confirmation. Refused while any mailing record exists (mailing history
 * is kept; archive the client instead).
 */
export async function deleteClient(ctx: Ctx, id: string, confirmation: string): Promise<void> {
  parse(uuid, id);
  const client = assertFound(await ctx.store.get("clients", id), "Client");
  if (confirmation.trim() !== client.full_name.trim()) {
    throw new UserError("Type the client's full name exactly to confirm deletion.");
  }
  const mailings = await ctx.store.list("mailings", { client_id: id });
  if (mailings.length > 0) {
    throw new UserError("This client has mailing records, which are kept for your history. Archive the client instead.");
  }
  const documents = await ctx.store.list("documents", { client_id: id });
  const packets = await ctx.store.list("mailing_packets", { client_id: id });
  await ctx.store.remove("clients", id);
  for (const path of [...documents.map((d) => d.storage_path), ...packets.map((p) => p.storage_path)]) {
    await ctx.store.removeFile(path).catch(() => undefined);
  }
  await recordAudit(ctx, {
    action: "client.deleted",
    record_type: "client",
    record_id: id,
    client_id: null,
    summary: "Client and related records permanently deleted",
    metadata: { documents: documents.length, packets: packets.length },
  });
}

export async function listClients(ctx: Ctx, opts: { q?: string; includeArchived?: boolean } = {}) {
  const q = (opts.q ?? "").trim().toLowerCase();
  const rows = await ctx.store.list("clients");
  return rows
    .filter((c) => opts.includeArchived || !c.archived_at)
    .filter(
      (c) =>
        !q ||
        [c.full_name, c.email, c.phone, c.city, ...c.tags].some((v) => (v ?? "").toLowerCase().includes(q)),
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

const caseSchema = z.object({
  title: requiredText(200, "Case title"),
  category: optionalText(80).transform((s) => s || "general"),
  description: optionalText(20000),
  organization: optionalText(200),
  account_last4: z
    .string()
    .optional()
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null))
    .refine((s) => s === null || /^\d{4}$/.test(s), "Account reference must be exactly the last four digits."),
  status: z.enum(CASE_STATUSES).default("open"),
  next_action: optionalText(500),
  reminder_date: optionalDate,
  acting_for_another: z.boolean().optional().default(false),
  authorization_on_file: z.boolean().optional().default(false),
  authorization_notes: optionalText(2000),
  outcome: optionalText(5000),
});
export type CaseInput = z.input<typeof caseSchema>;

export async function createCase(ctx: Ctx, clientId: string, input: CaseInput): Promise<CaseRow> {
  parse(uuid, clientId);
  const client = assertFound(await ctx.store.get("clients", clientId), "Client");
  const data = parse(caseSchema, input);
  assertNoSensitiveNumbers({ description: data.description, next_action: data.next_action });
  const row = await ctx.store.insert("cases", {
    ...data,
    owner_id: ctx.owner.id,
    client_id: client.id,
    closed_at: data.status === "closed" ? nowIso() : null,
  });
  await recordAudit(ctx, {
    action: "case.created",
    record_type: "case",
    record_id: row.id,
    client_id: client.id,
    case_id: row.id,
    summary: `Case created: ${row.title}`,
  });
  return row;
}

export async function updateCase(ctx: Ctx, id: string, input: CaseInput): Promise<CaseRow> {
  parse(uuid, id);
  const existing = assertFound(await ctx.store.get("cases", id), "Case");
  const data = parse(caseSchema, input);
  assertNoSensitiveNumbers({ description: data.description, next_action: data.next_action });
  const closing = data.status === "closed" && existing.status !== "closed";
  const reopening = data.status !== "closed" && existing.status === "closed";
  const row = assertFound(
    await ctx.store.update("cases", id, {
      ...data,
      closed_at: closing ? nowIso() : reopening ? null : existing.closed_at,
    }),
    "Case",
  );
  await recordAudit(ctx, {
    action: closing ? "case.closed" : "case.edited",
    record_type: "case",
    record_id: id,
    client_id: row.client_id,
    case_id: id,
    summary: closing ? `Case closed${row.outcome ? `: ${row.outcome.slice(0, 120)}` : ""}` : `Case updated: ${row.title}`,
    metadata: { status: row.status, previous_status: existing.status },
  });
  return row;
}

const noteSchema = z.object({
  body: requiredText(20000, "Note"),
  case_id: z
    .string()
    .optional()
    .nullable()
    .transform((s) => (s ? s : null)),
  session_date: optionalDate,
});

export async function addNote(ctx: Ctx, clientId: string, input: z.input<typeof noteSchema>) {
  parse(uuid, clientId);
  const client = assertFound(await ctx.store.get("clients", clientId), "Client");
  const data = parse(noteSchema, input);
  assertNoSensitiveNumbers({ note: data.body });
  if (data.case_id) {
    const c = assertFound(await ctx.store.get("cases", data.case_id), "Case");
    if (c.client_id !== client.id) throw new UserError("That case belongs to a different client.");
  }
  const row = await ctx.store.insert("case_notes", { ...data, owner_id: ctx.owner.id, client_id: client.id });
  await recordAudit(ctx, {
    action: "note.added",
    record_type: "case_note",
    record_id: row.id,
    client_id: client.id,
    case_id: row.case_id,
    summary: "Coaching/session note added",
  });
  return row;
}

/** Everything shown on a client detail screen, loaded with the same-client guarantee. */
export async function getClientBundle(ctx: Ctx, clientId: string) {
  parse(uuid, clientId);
  const client = await ctx.store.get("clients", clientId);
  if (!client) return null;
  const [cases, notes, documents, letters, mailings, responses, followUps, packets] = await Promise.all([
    ctx.store.list("cases", { client_id: clientId }),
    ctx.store.list("case_notes", { client_id: clientId }),
    ctx.store.list("documents", { client_id: clientId }),
    ctx.store.list("letters", { client_id: clientId }),
    ctx.store.list("mailings", { client_id: clientId }),
    ctx.store.list("responses", { client_id: clientId }),
    ctx.store.list("follow_ups", { client_id: clientId }),
    ctx.store.list("mailing_packets", { client_id: clientId }),
  ]);
  const byNewest = <T extends { created_at: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at);
  return {
    client,
    cases: cases.sort(byNewest),
    notes: notes.sort(byNewest),
    documents: documents.sort(byNewest),
    letters: letters.sort(byNewest),
    mailings: mailings.sort(byNewest),
    responses: responses.sort(byNewest),
    followUps: followUps.sort((a, b) => a.due_date.localeCompare(b.due_date)),
    packets: packets.sort(byNewest),
  };
}

/** JSON export of one client's records (document metadata only, never file contents). */
export async function exportClient(ctx: Ctx, clientId: string) {
  const bundle = assertFound(await getClientBundle(ctx, clientId), "Client");
  const audit = (await ctx.store.list("audit_events", { client_id: clientId })).sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at),
  );
  await recordAudit(ctx, {
    action: "export.client",
    record_type: "client",
    record_id: clientId,
    client_id: clientId,
    summary: "Client records exported (JSON)",
  });
  return {
    exported_at: nowIso(),
    data_mode: ctx.isDemo ? "demo (fictional)" : "connected",
    note: "Document files are not included; download them individually from the Documents tab.",
    ...bundle,
    documents: bundle.documents.map(({ storage_path: _p, ...d }) => (void _p, d)),
    packets: bundle.packets.map(({ storage_path: _p, ...p }) => (void _p, p)),
    audit,
  };
}
