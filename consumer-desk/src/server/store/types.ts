import type { AppSettingsRow, Insertable, Patch, TableName, Tables } from "../types";

export type StoreErrorCode =
  | "unique_violation"
  | "foreign_key_violation"
  | "check_violation"
  | "rule_violation"
  | "forbidden"
  | "not_found"
  | "unavailable"
  | "unknown";

export class StoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export interface UpdateOptions<T extends TableName> {
  /** Compare-and-set: the update only applies when these columns currently hold these values. */
  where?: Partial<Tables[T]>;
}

/**
 * The persistence boundary. Two implementations exist:
 *  - DemoStore: in-memory fictional data, resets when the server restarts.
 *  - SupabaseStore: PostgreSQL + private Storage through the signed-in owner's session (RLS enforced).
 * Services never know which one they are talking to, and neither falls back to the other.
 */
export interface Store {
  readonly kind: "demo" | "supabase";
  list<T extends TableName>(table: T, where?: Partial<Tables[T]>): Promise<Tables[T][]>;
  get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null>;
  insert<T extends TableName>(table: T, row: Insertable<T>): Promise<Tables[T]>;
  update<T extends TableName>(
    table: T,
    id: string,
    patch: Patch<T>,
    options?: UpdateOptions<T>,
  ): Promise<Tables[T] | null>;
  remove<T extends TableName>(table: T, id: string): Promise<void>;

  getSettings(ownerId: string): Promise<AppSettingsRow | null>;
  saveSettings(row: AppSettingsRow): Promise<AppSettingsRow>;

  putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getFile(path: string): Promise<Uint8Array | null>;
  removeFile(path: string): Promise<void>;
}
