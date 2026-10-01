import { providerFor } from "../mail";
import type { ProviderDescriptor, VerifyResult } from "../mail/types";
import type { MailMode, ProviderApiLogRow, ProviderConnectionRow, VerificationStatus } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError } from "./errors";
import { nowIso } from "./time";

export function activeProvider(ctx: Ctx) {
  return providerFor(ctx.policy, ctx.config);
}

export interface ProviderCall {
  operation: string;
  outcome: ProviderApiLogRow["outcome"];
  httpStatus?: number | null;
  message?: string;
  mailingId?: string | null;
}

/** Records a provider interaction: operation, outcome and a short safe message. No payloads, no secrets. */
export async function recordProviderCall(ctx: Ctx, descriptor: ProviderDescriptor, call: ProviderCall) {
  const mode: MailMode = descriptor.mode;
  await ctx.store.insert("provider_api_log", {
    owner_id: ctx.owner.id,
    provider: descriptor.id,
    mode,
    operation: call.operation,
    outcome: call.outcome,
    http_status: call.httpStatus ?? null,
    message: (call.message ?? "").slice(0, 300),
    mailing_id: call.mailingId ?? null,
  });
  const existing = (await ctx.store.list("provider_connections", { provider: descriptor.id, mode }))[0];
  const now = nowIso();
  const patch: Partial<ProviderConnectionRow> = {
    last_request_at: now,
    last_request_operation: call.operation,
    last_response_status: call.httpStatus ? `${call.outcome} (HTTP ${call.httpStatus})` : call.outcome,
    ...(call.outcome === "ok" ? { last_success_at: now } : { last_error: (call.message ?? call.outcome).slice(0, 300) }),
    ...(call.operation === "status" && call.outcome === "ok" ? { last_status_sync_at: now } : {}),
  };
  if (call.operation === "verify_connection" && descriptor.id === "letterstream") {
    patch.verification_status = call.outcome === "ok" ? "verified" : call.outcome === "error" ? "failed" : baseStatus(descriptor);
    if (call.outcome === "ok") patch.last_verified_at = now;
  }
  if (existing) {
    await ctx.store.update("provider_connections", existing.id, patch);
  } else {
    await ctx.store.insert("provider_connections", {
      owner_id: ctx.owner.id,
      provider: descriptor.id,
      mode,
      verification_status: baseStatus(descriptor),
      last_verified_at: null,
      last_success_at: null,
      last_request_at: null,
      last_request_operation: null,
      last_response_status: null,
      last_error: null,
      last_status_sync_at: null,
      ...patch,
    });
  }
}

function baseStatus(d: ProviderDescriptor): VerificationStatus {
  return d.configured ? "configured_unverified" : "not_configured";
}

export type ConnectionLabel =
  | "Simulated (mock provider)"
  | "Not configured"
  | "Configured but unverified"
  | "Verified"
  | "Verification failed"
  | "Blocked by configuration";

export async function getConnectionState(ctx: Ctx) {
  const provider = activeProvider(ctx);
  const descriptor = provider?.descriptor() ?? null;
  const rows = descriptor ? await ctx.store.list("provider_connections", { provider: descriptor.id, mode: descriptor.mode }) : [];
  const row = rows[0] ?? null;
  const log = (await ctx.store.list("provider_api_log"))
    .filter((l) => !descriptor || (l.provider === descriptor.id && l.mode === descriptor.mode))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  let label: ConnectionLabel;
  if (!descriptor) label = "Blocked by configuration";
  else if (descriptor.id === "mock") label = "Simulated (mock provider)";
  else if (!descriptor.configured) label = "Not configured";
  // "Verified" requires a stored, successful, documented non-mailing verification.
  else if (row?.verification_status === "verified" && descriptor.capabilities.verify_connection.supported) label = "Verified";
  else if (row?.verification_status === "failed") label = "Verification failed";
  else label = "Configured but unverified";

  return {
    descriptor,
    label,
    row,
    recentLog: log.slice(0, 15),
    recentErrors: log.filter((l) => l.outcome !== "ok").slice(0, 8),
    lastSuccessfulConnection: row?.last_success_at ?? null,
    lastStatusSync: row?.last_status_sync_at ?? null,
  };
}

export async function testConnection(ctx: Ctx): Promise<VerifyResult> {
  const provider = activeProvider(ctx);
  if (!provider) throw new UserError(ctx.policy.blockedReason ?? "No mailing provider is available in this configuration.");
  const descriptor = provider.descriptor();
  let result: VerifyResult;
  try {
    result = await provider.verifyConnection();
  } catch {
    result = { kind: "failed", message: "The verification request failed." };
  }
  await recordProviderCall(ctx, descriptor, {
    operation: "verify_connection",
    outcome: result.kind === "ok" ? "ok" : result.kind === "blocked" ? "blocked" : "error",
    message: result.message,
  });
  await recordAudit(ctx, {
    action: "provider.connection_tested",
    record_type: "provider_connection",
    source: "system",
    summary: `Connection test (${descriptor.displayName}): ${result.kind}`,
  });
  return result;
}
