import type { Ctx } from "./ctx";
import type { EventSource } from "../types";

export interface AuditInput {
  action: string;
  record_type: string;
  record_id?: string | null;
  client_id?: string | null;
  case_id?: string | null;
  source?: EventSource;
  summary: string;
  /** Only identifiers, statuses and short owner-entered notes. Never secrets or document contents. */
  metadata?: Record<string, unknown>;
}

const FORBIDDEN_METADATA_KEYS = /key|secret|token|password|authorization|pdf|bytes|content/i;

export function sanitizeMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 50).map((x) => (typeof x === "object" ? String(x) : x));
  }
  return out;
}

export async function recordAudit(ctx: Ctx, input: AuditInput): Promise<void> {
  await ctx.store.insert("audit_events", {
    owner_id: ctx.owner.id,
    occurred_at: new Date().toISOString(),
    action: input.action,
    record_type: input.record_type,
    record_id: input.record_id ?? null,
    client_id: input.client_id ?? null,
    case_id: input.case_id ?? null,
    source: input.source ?? "owner",
    actor_id: input.source === "provider" || input.source === "simulation" ? null : ctx.owner.id,
    summary: input.summary.slice(0, 300),
    metadata: sanitizeMetadata(input.metadata),
  });
}
