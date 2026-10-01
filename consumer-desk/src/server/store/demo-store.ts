import "server-only";
import { randomUUID } from "node:crypto";
import type { AppSettingsRow, Insertable, PacketRow, Patch, TableName, Tables } from "../types";
import { StoreError, type Store, type UpdateOptions } from "./types";

/**
 * In-memory store for DEMO MODE. Holds only fictional seed data plus whatever you create while
 * testing. Nothing is written to disk; all demo data resets when the server process restarts.
 *
 * It emulates the database rules that matter for correctness (unique keys, same-client foreign
 * keys, immutable rows, packet/mailing guards) so demo behaviour matches the connected app.
 */

type AnyRow = Record<string, unknown> & { id: string };

const UNIQUE: Partial<Record<TableName, string[][]>> = {
  letter_attachments: [["letter_id", "document_id"]],
  letter_versions: [["letter_id", "version_no"]],
  mailing_packets: [["storage_path"]],
  mailings: [["packet_id"], ["idempotency_key"]],
  documents: [["storage_path"]],
  provider_connections: [["owner_id", "provider", "mode"]],
};

/** [column, parent table] pairs where parent.client_id must equal row.client_id. */
const SAME_CLIENT_FK: Partial<Record<TableName, [string, TableName][]>> = {
  cases: [],
  case_notes: [["case_id", "cases"]],
  documents: [["case_id", "cases"]],
  letters: [["case_id", "cases"]],
  letter_attachments: [
    ["letter_id", "letters"],
    ["document_id", "documents"],
  ],
  letter_versions: [["letter_id", "letters"]],
  mailing_packets: [
    ["letter_version_id", "letter_versions"],
    ["letter_id", "letters"],
    ["case_id", "cases"],
  ],
  mailings: [
    ["packet_id", "mailing_packets"],
    ["case_id", "cases"],
  ],
  mailing_events: [["mailing_id", "mailings"]],
  responses: [
    ["case_id", "cases"],
    ["mailing_id", "mailings"],
    ["document_id", "documents"],
  ],
  follow_ups: [
    ["case_id", "cases"],
    ["mailing_id", "mailings"],
    ["response_id", "responses"],
  ],
};

const HAS_CLIENT_ID = new Set<TableName>([
  "cases",
  "case_notes",
  "documents",
  "letters",
  "letter_attachments",
  "letter_versions",
  "mailing_packets",
  "mailings",
  "mailing_events",
  "responses",
  "follow_ups",
]);

const APPEND_ONLY = new Set<TableName>(["letter_versions", "audit_events", "mailing_events", "provider_api_log"]);
const HAS_UPDATED_AT = new Set<TableName>([
  "clients",
  "cases",
  "templates",
  "letters",
  "mailings",
  "responses",
  "follow_ups",
  "provider_connections",
]);

/** Child tables removed when a parent row is deleted (mirrors ON DELETE CASCADE). */
const CASCADE: Partial<Record<TableName, [TableName, string][]>> = {
  clients: [
    ["cases", "client_id"],
    ["case_notes", "client_id"],
    ["documents", "client_id"],
    ["letters", "client_id"],
    ["responses", "client_id"],
    ["follow_ups", "client_id"],
  ],
  cases: [
    ["case_notes", "case_id"],
    ["letters", "case_id"],
    ["responses", "case_id"],
    ["follow_ups", "case_id"],
  ],
  letters: [
    ["letter_attachments", "letter_id"],
    ["letter_versions", "letter_id"],
    ["mailing_packets", "letter_id"],
  ],
};

/** Deleting a parent is refused while these children exist (mirrors ON DELETE RESTRICT). */
const RESTRICT: Partial<Record<TableName, [TableName, string][]>> = {
  clients: [["mailings", "client_id"]],
  cases: [["mailings", "case_id"]],
  mailing_packets: [["mailings", "packet_id"]],
  documents: [["letter_attachments", "document_id"]],
};

const PACKET_CONTENT_COLUMNS: (keyof PacketRow)[] = [
  "letter_version_id",
  "storage_path",
  "pdf_sha256",
  "packet_hash",
  "page_count",
  "sender_snapshot",
  "recipient_snapshot",
  "attachments_snapshot",
  "mail_options",
  "client_id",
  "letter_id",
];

const LETTER_CONTENT_COLUMNS = [
  "body",
  "title",
  "sender_address",
  "recipient_name",
  "recipient_address",
  "mail_options",
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function matches(row: AnyRow, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => same(row[k], v));
}

export class DemoStore implements Store {
  readonly kind = "demo" as const;
  private tables = new Map<TableName, Map<string, AnyRow>>();
  private settings = new Map<string, AppSettingsRow>();
  private files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  private table(name: TableName): Map<string, AnyRow> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  async list<T extends TableName>(table: T, where?: Partial<Tables[T]>): Promise<Tables[T][]> {
    const rows = [...this.table(table).values()].filter((r) => matches(r, where as Record<string, unknown>));
    return clone(rows) as unknown as Tables[T][];
  }

  async get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null> {
    const row = this.table(table).get(id);
    return row ? (clone(row) as unknown as Tables[T]) : null;
  }

  async insert<T extends TableName>(table: T, input: Insertable<T>): Promise<Tables[T]> {
    const now = new Date().toISOString();
    const row: AnyRow = {
      created_at: now,
      ...(HAS_UPDATED_AT.has(table) ? { updated_at: now } : {}),
      ...(table === "audit_events" ? { occurred_at: now } : {}),
      ...(table === "mailing_events" ? { recorded_at: now } : {}),
      ...(clone(input) as Record<string, unknown>),
      id: ((input as { id?: string }).id ?? randomUUID()) as string,
    };
    if (this.table(table).has(row.id)) throw new StoreError("unique_violation", `${table}: duplicate id`);
    this.checkUnique(table, row);
    this.checkForeignKeys(table, row);
    if (table === "mailings") {
      const packet = this.table("mailing_packets").get(row.packet_id as string);
      if (!packet || packet.status !== "approved") {
        throw new StoreError("rule_violation", "mailings require an approved packet");
      }
      if (packet.case_id !== row.case_id) throw new StoreError("rule_violation", "mailing case does not match its packet");
    }
    this.table(table).set(row.id, row);
    return clone(row) as unknown as Tables[T];
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    patch: Patch<T>,
    options?: UpdateOptions<T>,
  ): Promise<Tables[T] | null> {
    const current = this.table(table).get(id);
    if (!current) return null;
    if (!matches(current, options?.where as Record<string, unknown>)) return null;
    if (APPEND_ONLY.has(table)) throw new StoreError("rule_violation", `${table} rows are immutable`);

    const next: AnyRow = { ...current, ...(clone(patch) as Record<string, unknown>), id };
    if (HAS_UPDATED_AT.has(table)) next.updated_at = new Date().toISOString();

    if (table === "mailing_packets") this.guardPacket(current, next);
    if (table === "letters") {
      const contentChanged = LETTER_CONTENT_COLUMNS.some((c) => !same(current[c], next[c]));
      if (contentChanged && current.locked_at) {
        throw new StoreError(
          "rule_violation",
          "this letter has a mailing record and is locked; create a new mailing from its packet",
        );
      }
      if (contentChanged) next.status = "draft";
    }
    this.checkUnique(table, next, id);
    this.checkForeignKeys(table, next);
    this.table(table).set(id, next);
    return clone(next) as unknown as Tables[T];
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const row = this.table(table).get(id);
    if (!row) return;
    this.assertDeletable(table, id);
    this.cascadeDelete(table, id);
  }

  private assertDeletable(table: TableName, id: string) {
    for (const [child, col] of RESTRICT[table] ?? []) {
      const blocked = [...this.table(child).values()].some((r) => r[col] === id);
      // Attachments are cascaded away with their letter when the whole client goes.
      if (blocked && !(table === "documents" && child === "letter_attachments" && this.deletingClient)) {
        throw new StoreError("foreign_key_violation", `${table} is still referenced by ${child}`);
      }
    }
    for (const [child, col] of CASCADE[table] ?? []) {
      for (const r of this.table(child).values()) if (r[col] === id) this.assertDeletable(child, r.id);
    }
  }

  private deletingClient = false;

  private cascadeDelete(table: TableName, id: string) {
    const wasDeletingClient = this.deletingClient;
    if (table === "clients") this.deletingClient = true;
    try {
      for (const [child, col] of CASCADE[table] ?? []) {
        for (const r of [...this.table(child).values()]) if (r[col] === id) this.cascadeDelete(child, r.id);
      }
      this.table(table).delete(id);
      // ON DELETE SET NULL columns
      if (table === "documents") {
        for (const r of this.table("responses").values()) if (r.document_id === id) r.document_id = null;
        for (const r of [...this.table("letter_attachments").values()]) {
          if (r.document_id === id) this.table("letter_attachments").delete(r.id);
        }
      }
      if (table === "cases") {
        for (const r of this.table("documents").values()) if (r.case_id === id) r.case_id = null;
      }
    } finally {
      this.deletingClient = wasDeletingClient;
    }
  }

  private checkUnique(table: TableName, row: AnyRow, selfId?: string) {
    for (const cols of UNIQUE[table] ?? []) {
      for (const other of this.table(table).values()) {
        if (other.id === selfId) continue;
        if (cols.every((c) => same(other[c], row[c]))) {
          throw new StoreError("unique_violation", `${table}: duplicate ${cols.join(", ")}`);
        }
      }
    }
  }

  private checkForeignKeys(table: TableName, row: AnyRow) {
    if (HAS_CLIENT_ID.has(table) || table === "cases") {
      const clientId = row.client_id as string | undefined;
      if (!clientId || !this.table("clients").has(clientId)) {
        throw new StoreError("foreign_key_violation", `${table}: client does not exist`);
      }
    }
    for (const [col, parent] of SAME_CLIENT_FK[table] ?? []) {
      const ref = row[col];
      if (ref === null || ref === undefined) continue;
      const parentRow = this.table(parent).get(ref as string);
      if (!parentRow || parentRow.client_id !== row.client_id) {
        throw new StoreError(
          "foreign_key_violation",
          `${table}.${col} must reference a ${parent} record that belongs to the same client`,
        );
      }
    }
  }

  private guardPacket(current: AnyRow, next: AnyRow) {
    for (const c of PACKET_CONTENT_COLUMNS) {
      if (!same(current[c], next[c])) {
        throw new StoreError("rule_violation", "packet content is immutable; generate a new packet");
      }
    }
    if (current.status === "invalidated" && next.status !== "invalidated") {
      throw new StoreError("rule_violation", "an invalidated packet cannot be re-approved");
    }
    if (current.status === "approved") {
      if (next.status === "pending_review") {
        throw new StoreError("rule_violation", "an approved packet cannot return to review");
      }
      if (
        !same(current.quote_cents, next.quote_cents) ||
        !same(current.approved_at, next.approved_at) ||
        !same(current.approved_by, next.approved_by)
      ) {
        throw new StoreError("rule_violation", "approved packet details are immutable");
      }
    }
    if (next.status === "approved" && (!next.approved_at || !next.approved_by)) {
      throw new StoreError("check_violation", "approved packets need approved_at and approved_by");
    }
    if (next.status === "invalidated" && current.status !== "invalidated") {
      const hasMailing = [...this.table("mailings").values()].some((m) => m.packet_id === current.id);
      if (hasMailing) throw new StoreError("rule_violation", "a packet that has a mailing record cannot be invalidated");
    }
  }

  async getSettings(ownerId: string): Promise<AppSettingsRow | null> {
    const s = this.settings.get(ownerId);
    return s ? clone(s) : null;
  }

  async saveSettings(row: AppSettingsRow): Promise<AppSettingsRow> {
    const saved = { ...clone(row), updated_at: new Date().toISOString() };
    this.settings.set(row.owner_id, saved);
    return clone(saved);
  }

  async putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.files.has(path)) throw new StoreError("unique_violation", "file already exists");
    this.files.set(path, { bytes: new Uint8Array(bytes), contentType });
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const f = this.files.get(path);
    return f ? new Uint8Array(f.bytes) : null;
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
  }
}
