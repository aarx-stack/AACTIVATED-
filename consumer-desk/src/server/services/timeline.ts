import type { EventSource } from "../types";
import type { Ctx } from "./ctx";
import { recordAudit } from "./audit";
import { nowIso } from "./time";

export interface TimelineEntry {
  id: string;
  at: string;
  action: string;
  summary: string;
  source: EventSource;
  caseId: string | null;
  caseTitle: string | null;
  recordType: string;
  recordId: string | null;
  href: string | null;
  notes: string | null;
}

function hrefFor(recordType: string, recordId: string | null, clientId: string): string | null {
  if (!recordId) return null;
  switch (recordType) {
    case "letter":
      return `/letters/${recordId}`;
    case "mailing_packet":
      return `/packets/${recordId}`;
    case "mailing":
      return `/mailings/${recordId}`;
    case "response":
      return `/responses/${recordId}`;
    case "document":
      return `/api/documents/${recordId}`;
    case "case":
      return `/clients/${clientId}?tab=cases#case-${recordId}`;
    default:
      return null;
  }
}

/** Chronological client history built from the append-only audit log. */
export async function clientTimeline(ctx: Ctx, clientId: string): Promise<TimelineEntry[]> {
  const [events, cases] = await Promise.all([
    ctx.store.list("audit_events", { client_id: clientId }),
    ctx.store.list("cases", { client_id: clientId }),
  ]);
  const caseTitle = new Map(cases.map((c) => [c.id, c.title]));
  return events
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map((e) => ({
      id: e.id,
      at: e.occurred_at,
      action: e.action,
      summary: e.summary,
      source: e.source,
      caseId: e.case_id,
      caseTitle: e.case_id ? (caseTitle.get(e.case_id) ?? null) : null,
      recordType: e.record_type,
      recordId: e.record_id,
      href: hrefFor(e.record_type, e.record_id, clientId),
      notes: typeof e.metadata?.notes === "string" && e.metadata.notes ? (e.metadata.notes as string) : null,
    }));
}

export async function globalSearch(ctx: Ctx, q: string) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { clients: [], cases: [], letters: [], mailings: [] };
  const has = (...values: (string | null | undefined)[]) => values.some((v) => (v ?? "").toLowerCase().includes(needle));
  const [clients, cases, letters, mailings] = await Promise.all([
    ctx.store.list("clients"),
    ctx.store.list("cases"),
    ctx.store.list("letters"),
    ctx.store.list("mailings"),
  ]);
  return {
    clients: clients.filter((c) => has(c.full_name, c.email, c.phone, c.city, c.tags.join(" "))).slice(0, 25),
    cases: cases.filter((c) => has(c.title, c.organization, c.category)).slice(0, 25),
    letters: letters.filter((l) => has(l.title, l.recipient_name, l.recipient_address.name)).slice(0, 25),
    mailings: mailings
      .filter((m) => has(m.tracking_number, m.provider_reference, m.recipient_snapshot.name))
      .slice(0, 25),
  };
}

/** Full JSON backup of all records (document metadata only; files are not embedded). */
export async function exportAll(ctx: Ctx) {
  const tables = [
    "clients",
    "cases",
    "case_notes",
    "documents",
    "templates",
    "letters",
    "letter_attachments",
    "letter_versions",
    "mailing_packets",
    "mailings",
    "mailing_events",
    "responses",
    "follow_ups",
    "audit_events",
  ] as const;
  const out: Record<string, unknown> = {
    exported_at: nowIso(),
    data_mode: ctx.isDemo ? "demo (fictional)" : "connected",
    note: "Files are not embedded. Back up the private storage bucket separately (see README).",
  };
  for (const t of tables) out[t] = await ctx.store.list(t);
  await recordAudit(ctx, { action: "export.full", record_type: "backup", summary: "Full JSON export created" });
  return out;
}

export function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Generic recipient CSV. This is NOT a LetterStream import format — LetterStream's CSV layout
 * has not been verified. Column names are this application's own.
 */
export async function recipientCsv(ctx: Ctx, packetIds: string[]) {
  const rows = ["packet_id,recipient_name,address_line1,address_line2,city,state,postal_code,country,pages,service,return_receipt"];
  for (const id of packetIds) {
    const p = await ctx.store.get("mailing_packets", id);
    if (!p) continue;
    const r = p.recipient_snapshot;
    rows.push(
      [p.id, r.name, r.line1, r.line2, r.city, r.state, r.postal_code, r.country ?? "US", p.page_count, p.mail_options.service, p.mail_options.return_receipt]
        .map(csvEscape)
        .join(","),
    );
  }
  await recordAudit(ctx, {
    action: "export.recipient_csv",
    record_type: "mailing_packet",
    summary: `Generic recipient CSV exported (${packetIds.length} packet${packetIds.length === 1 ? "" : "s"})`,
  });
  return rows.join("\n") + "\n";
}
