import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSettingsRow, Insertable, Patch, TableName, Tables } from "../types";
import { StoreError, type Store, type StoreErrorCode, type UpdateOptions } from "./types";

export const PRIVATE_BUCKET = "consumer-desk-private";
const PAGE = 500;

interface PgError {
  code?: string;
  message?: string;
}

function mapError(table: string, err: PgError): StoreError {
  const code = err.code ?? "";
  const map: Record<string, StoreErrorCode> = {
    "23505": "unique_violation",
    "23503": "foreign_key_violation",
    "23514": "check_violation",
    "23502": "check_violation",
    "22P02": "check_violation",
    P0001: "rule_violation",
    "42501": "forbidden",
    PGRST116: "not_found",
  };
  const mapped = map[code] ?? "unknown";
  // Never echo raw database messages for unknown errors; they can contain row data.
  const safeMessage =
    mapped === "rule_violation" || mapped === "check_violation" || mapped === "unique_violation"
      ? (err.message ?? mapped)
      : `${table}: ${mapped}`;
  return new StoreError(mapped, safeMessage);
}

/**
 * Persistence for the private connected app. All reads and writes go through the signed-in
 * owner's session, so PostgreSQL row-level security and Storage policies apply to every call.
 * Failures throw; there is no fallback to demo data.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;

  constructor(private readonly db: SupabaseClient) {}

  async list<T extends TableName>(table: T, where?: Partial<Tables[T]>): Promise<Tables[T][]> {
    const out: Tables[T][] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.db.from(table).select("*");
      for (const [k, v] of Object.entries(where ?? {})) {
        q = v === null ? q.is(k, null) : q.eq(k, v as string);
      }
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) throw mapError(table, error);
      out.push(...((data ?? []) as Tables[T][]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null> {
    const { data, error } = await this.db.from(table).select("*").eq("id", id).maybeSingle();
    if (error) {
      if (error.code === "22P02") return null; // not a uuid
      throw mapError(table, error);
    }
    return (data as Tables[T] | null) ?? null;
  }

  async insert<T extends TableName>(table: T, row: Insertable<T>): Promise<Tables[T]> {
    const { data, error } = await this.db.from(table).insert(row as never).select("*").single();
    if (error) throw mapError(table, error);
    return data as Tables[T];
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    patch: Patch<T>,
    options?: UpdateOptions<T>,
  ): Promise<Tables[T] | null> {
    let q = this.db.from(table).update(patch as never).eq("id", id);
    for (const [k, v] of Object.entries(options?.where ?? {})) {
      q = v === null ? q.is(k, null) : q.eq(k, v as string);
    }
    const { data, error } = await q.select("*");
    if (error) throw mapError(table, error);
    return ((data ?? [])[0] as Tables[T] | undefined) ?? null;
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const { error } = await this.db.from(table).delete().eq("id", id);
    if (error) throw mapError(table, error);
  }

  async getSettings(ownerId: string): Promise<AppSettingsRow | null> {
    const { data, error } = await this.db.from("app_settings").select("*").eq("owner_id", ownerId).maybeSingle();
    if (error) throw mapError("app_settings", error);
    return (data as AppSettingsRow | null) ?? null;
  }

  async saveSettings(row: AppSettingsRow): Promise<AppSettingsRow> {
    const { updated_at: _ignored, ...rest } = row;
    void _ignored;
    const { data, error } = await this.db
      .from("app_settings")
      .upsert(rest, { onConflict: "owner_id" })
      .select("*")
      .single();
    if (error) throw mapError("app_settings", error);
    return data as AppSettingsRow;
  }

  async putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.db.storage
      .from(PRIVATE_BUCKET)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "no-store" });
    if (error) throw new StoreError("unavailable", "Private storage rejected the upload.");
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const { data, error } = await this.db.storage.from(PRIVATE_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async removeFile(path: string): Promise<void> {
    const { error } = await this.db.storage.from(PRIVATE_BUCKET).remove([path]);
    if (error) throw new StoreError("unavailable", "Private storage could not delete the file.");
  }
}
