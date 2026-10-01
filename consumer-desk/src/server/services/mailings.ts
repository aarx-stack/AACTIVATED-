import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withReadRetry } from "../mail";
import type { MockSimulation, SubmitResult } from "../mail/types";
import { StoreError } from "../store/types";
import {
  DELIVERY_STATUSES,
  MAILING_STATUSES,
  type DeliveryStatus,
  type EventSource,
  type MailingRow,
  type MailingStatus,
} from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError, assertFound } from "./errors";
import { sha256Hex } from "./hash";
import { activeProvider, recordProviderCall } from "./provider-health";
import { nowIso } from "./time";
import { nullableText, optionalDate, optionalText, parse, uuid } from "./validation";

export const SUBMIT_TIMEOUT_MS = 30_000;

export interface SubmitInput {
  packetId: string;
  /** The packet hash shown to the owner on the review screen. Must still match. */
  packetHash: string;
  /** The separate, final "send" confirmation. */
  confirmFinal: boolean;
  /** Required whenever the active mode may create a real mailing or charge. */
  acknowledgeCharges: boolean;
  /** Mock provider only; ignored for any real provider. */
  simulate?: MockSimulation;
}

export interface SubmitOutcome {
  outcome: "accepted" | "rejected" | "unknown" | "duplicate";
  mailing: MailingRow;
  message: string;
}

function idempotencyKeyFor(packetId: string) {
  return `packet:${packetId}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

/**
 * Submits an approved packet through the active provider.
 * Safety rules (all enforced here on the server, not in the UI):
 *  - the mail policy must allow submission (MAIL_MODE / LIVE_MAILING_ENABLED / data mode),
 *  - demo (fictional) data can only ever reach the mock provider,
 *  - the exact approved packet must be confirmed (hash match) with a separate final confirmation,
 *  - a durable "submitting" record is created BEFORE the external call, guarded by a unique
 *    packet id and idempotency key, so double clicks and concurrent requests cannot send twice,
 *  - ambiguous outcomes become "submission_unknown" and are NEVER retried automatically.
 */
export async function submitMailing(ctx: Ctx, input: SubmitInput): Promise<SubmitOutcome> {
  parse(uuid, input.packetId);
  const policy = ctx.policy;
  if (!policy.canSubmit) throw new UserError(policy.blockedReason ?? "Mail submission is disabled.", "blocked");
  const provider = activeProvider(ctx);
  if (!provider) throw new UserError("No mailing provider is available in this configuration.", "blocked");
  const descriptor = provider.descriptor();
  if (ctx.isDemo && descriptor.id !== "mock") {
    throw new UserError("Demo (fictional) records can only use the mock provider.", "blocked");
  }
  if (descriptor.id !== policy.provider) throw new UserError("Provider does not match the active mail policy.", "blocked");
  if (!descriptor.capabilities.submit.supported) {
    throw new UserError(`Submission is not available: ${descriptor.capabilities.submit.basis}`, "blocked");
  }
  if (!descriptor.configured) {
    throw new UserError(`Provider is not configured. Missing: ${descriptor.missingEnv.join(", ")}`, "blocked");
  }

  const packet = assertFound(await ctx.store.get("mailing_packets", input.packetId), "Packet");
  const existing = (await ctx.store.list("mailings", { packet_id: packet.id }))[0];
  if (existing) {
    return { outcome: "duplicate", mailing: existing, message: "This packet already has a mailing record. Nothing was resent." };
  }
  if (packet.status !== "approved") throw new UserError("Only an approved packet can be sent. Review and approve it first.");
  if (input.packetHash !== packet.packet_hash) {
    throw new UserError("The packet you confirmed is not the current approved packet. Review it again.");
  }
  if (!input.confirmFinal) throw new UserError("Tick the final send confirmation.");
  if (policy.mayCreateRealMail && !input.acknowledgeCharges) {
    throw new UserError("Confirm that this action may create a real mailing and incur a charge.");
  }
  const service = descriptor.services.find((s) => s.value === packet.mail_options.service);
  if (!service?.supported) throw new UserError(`The ${packet.mail_options.service} service is not confirmed for this provider.`);
  if (packet.mail_options.return_receipt && !service.supportsReturnReceipt) {
    throw new UserError("Return receipt is not confirmed for this provider/service.");
  }

  const pdf = assertFound(await ctx.store.getFile(packet.storage_path), "Packet PDF");
  if (sha256Hex(pdf) !== packet.pdf_sha256) throw new UserError("The stored packet PDF does not match the approved version.");

  if (descriptor.capabilities.quote.supported) {
    const fresh = await provider.quote({
      packetId: packet.id,
      pdf,
      pageCount: packet.page_count,
      sender: packet.sender_snapshot,
      recipient: packet.recipient_snapshot,
      options: packet.mail_options,
    });
    if (fresh.kind !== "quote" || fresh.cents !== packet.quote_cents) {
      await ctx.store.update("mailing_packets", packet.id, {
        status: "invalidated",
        invalidated_at: nowIso(),
        invalidation_reason: "price changed or could not be confirmed",
      });
      await ctx.store.update("letters", packet.letter_id, { status: "draft" });
      throw new UserError("The price changed or could not be confirmed. The approval was invalidated; review the packet again.");
    }
  }

  const letter = assertFound(await ctx.store.get("letters", packet.letter_id), "Letter");
  const startedAt = nowIso();
  let mailing: MailingRow;
  try {
    mailing = await ctx.store.insert("mailings", {
      owner_id: ctx.owner.id,
      client_id: packet.client_id,
      case_id: packet.case_id,
      packet_id: packet.id,
      idempotency_key: idempotencyKeyFor(packet.id),
      mail_mode: policy.recordMode!,
      provider: descriptor.id,
      record_origin: descriptor.id === "mock" ? "simulated" : "api_reported",
      service: packet.mail_options.service,
      return_receipt: packet.mail_options.return_receipt,
      recipient_snapshot: packet.recipient_snapshot,
      page_count: packet.page_count,
      mailing_status: "submitting",
      delivery_status: service.tracking === "available" ? "pending" : "not_available",
      response_status: letter.expects_response ? "awaiting_response" : "not_expected",
      provider_status_raw: null,
      provider_reference: null,
      tracking_number: null,
      tracking_supported: service.tracking === "available",
      quote_cents: packet.quote_cents,
      actual_cost_cents: null,
      cost_currency: packet.quote_currency,
      awaiting_funding: false,
      submission_started_at: startedAt,
      submitted_at: null,
      accepted_at: null,
      mailed_at: null,
      delivered_at: null,
      last_status_refresh_at: null,
      last_error: null,
      unresolved_condition: null,
    });
  } catch (err) {
    if (err instanceof StoreError && err.code === "unique_violation") {
      const winner = (await ctx.store.list("mailings", { packet_id: packet.id }))[0];
      if (winner) return { outcome: "duplicate", mailing: winner, message: "A submission for this packet already exists. Nothing was resent." };
    }
    throw err;
  }

  await ctx.store.update("letters", letter.id, { locked_at: startedAt });
  await recordAudit(ctx, {
    action: "mailing.submission_started",
    record_type: "mailing",
    record_id: mailing.id,
    client_id: mailing.client_id,
    case_id: mailing.case_id,
    source: "system",
    summary: `Submission record created before contacting ${descriptor.displayName}`,
    metadata: { idempotency_key: mailing.idempotency_key, mode: mailing.mail_mode },
  });

  let result: SubmitResult | "timeout";
  try {
    result = await withTimeout(
      provider.submit({
        idempotencyKey: mailing.idempotency_key,
        packetId: packet.id,
        pdf,
        pageCount: packet.page_count,
        sender: packet.sender_snapshot,
        recipient: packet.recipient_snapshot,
        options: packet.mail_options,
        simulate: descriptor.id === "mock" ? input.simulate : undefined,
      }),
      SUBMIT_TIMEOUT_MS,
    );
  } catch {
    result = { kind: "unknown", message: "The submission request failed in a way that does not prove it was rejected." };
  }
  if (result === "timeout") {
    result = { kind: "unknown", message: `No response within ${SUBMIT_TIMEOUT_MS / 1000}s; the provider may have accepted it.` };
  }

  const source: EventSource = descriptor.id === "mock" ? "simulation" : "provider";
  const now = nowIso();

  if (result.kind === "accepted") {
    const updated = await ctx.store.update(
      "mailings",
      mailing.id,
      {
        mailing_status: "accepted",
        provider_status_raw: result.providerStatusRaw,
        provider_reference: result.providerReference,
        tracking_number: result.trackingNumber,
        actual_cost_cents: result.costCents,
        cost_currency: result.costCurrency ?? mailing.cost_currency,
        awaiting_funding: result.awaitingFunding,
        submitted_at: now,
        accepted_at: now,
        unresolved_condition: result.awaitingFunding
          ? "Provider accepted the job but it is awaiting funding/payment. It will not be produced until paid."
          : null,
      },
      { where: { mailing_status: "submitting" } },
    );
    mailing = updated ?? mailing;
    await ctx.store.insert("mailing_events", {
      owner_id: ctx.owner.id,
      client_id: mailing.client_id,
      mailing_id: mailing.id,
      source,
      event_type: "accepted",
      provider_status_raw: result.providerStatusRaw,
      mailing_status: "accepted",
      delivery_status: null,
      description: result.awaitingFunding ? "Provider accepted the job; awaiting funding." : "Provider accepted the job.",
      occurred_at: now,
      details: { provider_reference: result.providerReference },
    });
    await recordAudit(ctx, {
      action: "mailing.submitted",
      record_type: "mailing",
      record_id: mailing.id,
      client_id: mailing.client_id,
      case_id: mailing.case_id,
      summary: `Submitted to ${descriptor.displayName}`,
      metadata: { provider_reference: result.providerReference },
    });
    await recordAudit(ctx, {
      action: "provider.accepted",
      record_type: "mailing",
      record_id: mailing.id,
      client_id: mailing.client_id,
      case_id: mailing.case_id,
      source,
      summary: `${source === "simulation" ? "Simulated provider" : "Provider"} reported: accepted (${result.providerStatusRaw})${result.awaitingFunding ? " — awaiting funding" : ""}`,
    });
    await recordProviderCall(ctx, descriptor, { operation: "submit", outcome: "ok", message: result.providerStatusRaw, mailingId: mailing.id });
    return {
      outcome: "accepted",
      mailing,
      message: result.awaitingFunding
        ? "Accepted by the provider but awaiting funding. It has NOT been mailed."
        : "Accepted by the provider. This does not mean it has been mailed yet.",
    };
  }

  if (result.kind === "rejected") {
    mailing =
      (await ctx.store.update(
        "mailings",
        mailing.id,
        { mailing_status: "failed", provider_status_raw: result.providerStatusRaw, last_error: result.message, submitted_at: now },
        { where: { mailing_status: "submitting" } },
      )) ?? mailing;
    await recordAudit(ctx, {
      action: "mailing.submission_failed",
      record_type: "mailing",
      record_id: mailing.id,
      client_id: mailing.client_id,
      case_id: mailing.case_id,
      source,
      summary: `Provider rejected the submission: ${result.message}`,
    });
    await recordProviderCall(ctx, descriptor, {
      operation: "submit",
      outcome: "error",
      httpStatus: result.httpStatus,
      message: result.message,
      mailingId: mailing.id,
    });
    return { outcome: "rejected", mailing, message: result.message };
  }

  // "unknown" or "blocked" after the record exists: never resend automatically.
  const blockedBeforeSend = result.kind === "blocked";
  mailing =
    (await ctx.store.update(
      "mailings",
      mailing.id,
      blockedBeforeSend
        ? { mailing_status: "failed", last_error: `Not sent: ${result.message}` }
        : {
            mailing_status: "submission_unknown",
            submitted_at: now,
            last_error: result.message,
            unresolved_condition:
              "Submission outcome unknown. Do not resend. Check the provider account and record what you find.",
          },
      { where: { mailing_status: "submitting" } },
    )) ?? mailing;
  await recordAudit(ctx, {
    action: blockedBeforeSend ? "mailing.submission_failed" : "mailing.submission_unknown",
    record_type: "mailing",
    record_id: mailing.id,
    client_id: mailing.client_id,
    case_id: mailing.case_id,
    source: "system",
    summary: blockedBeforeSend ? `Not sent: ${result.message}` : "Submission outcome unknown — requires manual reconciliation",
  });
  await recordProviderCall(ctx, descriptor, {
    operation: "submit",
    outcome: blockedBeforeSend ? "blocked" : "unknown",
    message: result.message,
    mailingId: mailing.id,
  });
  return { outcome: blockedBeforeSend ? "rejected" : "unknown", mailing, message: result.message };
}

// ---------------------------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------------------------

interface StatusUpdate {
  source: EventSource;
  providerStatusRaw: string | null;
  mailingStatus?: MailingStatus;
  deliveryStatus?: DeliveryStatus;
  trackingNumber?: string | null;
  actualCostCents?: number | null;
  awaitingFunding?: boolean;
  occurredAt?: string | null;
  description: string;
  eventType: string;
}

export async function applyStatusUpdate(ctx: Ctx, mailing: MailingRow, u: StatusUpdate): Promise<MailingRow> {
  const now = nowIso();
  const patch: Partial<MailingRow> = { last_status_refresh_at: now };
  if (u.providerStatusRaw !== null && u.source !== "owner") patch.provider_status_raw = u.providerStatusRaw;
  if (u.mailingStatus && u.mailingStatus !== mailing.mailing_status) {
    patch.mailing_status = u.mailingStatus;
    if (u.mailingStatus === "accepted" && !mailing.accepted_at) patch.accepted_at = u.occurredAt ?? now;
    if (u.mailingStatus === "mailed" && !mailing.mailed_at) patch.mailed_at = u.occurredAt ?? now;
  }
  if (u.deliveryStatus && u.deliveryStatus !== mailing.delivery_status) {
    patch.delivery_status = u.deliveryStatus;
    if (u.deliveryStatus === "delivered" && !mailing.delivered_at) patch.delivered_at = u.occurredAt ?? now;
  }
  if (u.trackingNumber !== undefined && u.trackingNumber !== mailing.tracking_number) patch.tracking_number = u.trackingNumber;
  if (u.actualCostCents !== undefined) patch.actual_cost_cents = u.actualCostCents;
  if (u.awaitingFunding !== undefined) {
    patch.awaiting_funding = u.awaitingFunding;
    if (!u.awaitingFunding && mailing.unresolved_condition?.startsWith("Provider accepted the job but it is awaiting funding")) {
      patch.unresolved_condition = null;
    }
  }
  if (u.deliveryStatus === "delivery_exception") patch.unresolved_condition = "Delivery exception reported.";

  const updated = assertFound(await ctx.store.update("mailings", mailing.id, patch), "Mailing");
  await ctx.store.insert("mailing_events", {
    owner_id: ctx.owner.id,
    client_id: mailing.client_id,
    mailing_id: mailing.id,
    source: u.source,
    event_type: u.eventType,
    provider_status_raw: u.providerStatusRaw,
    mailing_status: u.mailingStatus ?? null,
    delivery_status: u.deliveryStatus ?? null,
    description: u.description,
    occurred_at: u.occurredAt ?? null,
    details: {},
  });
  const who = u.source === "provider" ? "Provider reported" : u.source === "simulation" ? "Simulated provider reported" : "Manually recorded";
  if (patch.mailing_status) {
    await recordAudit(ctx, {
      action: "provider.status_changed",
      record_type: "mailing",
      record_id: mailing.id,
      client_id: mailing.client_id,
      case_id: mailing.case_id,
      source: u.source,
      summary: `${who}: ${patch.mailing_status.replace(/_/g, " ")}${u.providerStatusRaw ? ` (${u.providerStatusRaw})` : ""}`,
      metadata: { from: mailing.mailing_status, to: patch.mailing_status },
    });
  }
  if (patch.delivery_status || patch.tracking_number !== undefined) {
    await recordAudit(ctx, {
      action: "tracking.updated",
      record_type: "mailing",
      record_id: mailing.id,
      client_id: mailing.client_id,
      case_id: mailing.case_id,
      source: u.source,
      summary: `${who}: ${patch.delivery_status ? `delivery ${patch.delivery_status.replace(/_/g, " ")}` : "tracking number updated"}`,
    });
  }
  if (!patch.mailing_status && !patch.delivery_status && patch.tracking_number === undefined && u.awaitingFunding !== undefined) {
    await recordAudit(ctx, {
      action: "provider.status_changed",
      record_type: "mailing",
      record_id: mailing.id,
      client_id: mailing.client_id,
      case_id: mailing.case_id,
      source: u.source,
      summary: `${who}: ${u.description}`,
    });
  }
  return updated;
}

/** Manual "Refresh status" — read-only provider call, retried with backoff. */
export async function refreshMailingStatus(ctx: Ctx, mailingId: string) {
  parse(uuid, mailingId);
  const mailing = assertFound(await ctx.store.get("mailings", mailingId), "Mailing");
  if (mailing.provider === "manual") {
    return { ok: false, message: "This mailing was recorded manually; there is no provider status to refresh. Update it manually." };
  }
  const provider = activeProvider(ctx);
  const descriptor = provider?.descriptor();
  if (!provider || !descriptor || descriptor.id !== mailing.provider) {
    return {
      ok: false,
      message: `This mailing used the ${mailing.provider} provider, which is not active in the current mode. Status was not refreshed.`,
    };
  }
  if (!descriptor.capabilities.status.supported) {
    return { ok: false, message: descriptor.capabilities.status.basis };
  }
  if (!mailing.provider_reference) {
    return { ok: false, message: "No provider reference is recorded, so the provider cannot be asked about this mailing." };
  }
  const result = await withReadRetry(() => provider.status(mailing.provider_reference!));
  await recordProviderCall(ctx, descriptor, {
    operation: "status",
    outcome: result.kind === "status" ? "ok" : result.kind === "unavailable" ? "blocked" : "error",
    message: result.kind === "status" ? result.providerStatusRaw : result.message,
    mailingId,
  });
  if (result.kind !== "status") {
    await ctx.store.update("mailings", mailingId, { last_error: result.message });
    return { ok: false, message: result.message };
  }
  const source: EventSource = descriptor.id === "mock" ? "simulation" : "provider";
  const noChange =
    !result.mailingStatus && !result.deliveryStatus && result.trackingNumber === undefined && result.events.length === 0;
  if (noChange) {
    await ctx.store.update("mailings", mailingId, { last_status_refresh_at: nowIso() });
    return {
      ok: true,
      message:
        descriptor.id === "mock"
          ? "Mock provider: no new simulated events. Use “Record simulated event” to advance a simulation."
          : `No change reported (${result.providerStatusRaw}).`,
    };
  }
  await applyStatusUpdate(ctx, mailing, {
    source,
    eventType: "status_refresh",
    providerStatusRaw: result.providerStatusRaw,
    mailingStatus: result.mailingStatus,
    deliveryStatus: result.deliveryStatus,
    trackingNumber: result.trackingNumber,
    actualCostCents: result.costCents ?? undefined,
    description: `Status refresh: ${result.providerStatusRaw}`,
  });
  return { ok: true, message: `Provider reported: ${result.providerStatusRaw}` };
}

export const SIMULATED_EVENTS = {
  funding_received: { label: "Funding received", raw: "SIMULATED_FUNDED" },
  processing: { label: "Entered production", raw: "SIMULATED_PROCESSING" },
  mailed: { label: "Mailed", raw: "SIMULATED_MAILED" },
  in_transit: { label: "Tracking: in transit", raw: "SIMULATED_IN_TRANSIT" },
  delivered: { label: "Tracking: delivered", raw: "SIMULATED_DELIVERED" },
  delivery_exception: { label: "Tracking: delivery exception", raw: "SIMULATED_DELIVERY_EXCEPTION" },
} as const;
export type SimulatedEvent = keyof typeof SIMULATED_EVENTS;

/** Mock provider only: records one explicitly chosen simulated provider event. */
export async function recordSimulatedEvent(ctx: Ctx, mailingId: string, event: SimulatedEvent) {
  parse(uuid, mailingId);
  if (!(event in SIMULATED_EVENTS)) throw new UserError("Unknown simulated event.");
  const mailing = assertFound(await ctx.store.get("mailings", mailingId), "Mailing");
  if (mailing.provider !== "mock") throw new UserError("Simulated events can only be recorded for mock-provider mailings.");
  if (["submitting", "failed", "cancelled", "not_submitted"].includes(mailing.mailing_status)) {
    throw new UserError(`Cannot simulate provider events for a mailing that is ${mailing.mailing_status.replace(/_/g, " ")}.`);
  }
  if (mailing.mailing_status === "submission_unknown") {
    throw new UserError("Reconcile the unknown submission first.");
  }
  const tracking = event === "in_transit" || event === "delivered" || event === "delivery_exception";
  if (tracking && !mailing.tracking_supported) {
    throw new UserError("Tracking is not available for this service, so no delivery events can be reported.");
  }
  if (tracking && mailing.mailing_status !== "mailed") throw new UserError("Record “Mailed” before tracking events.");
  if (event !== "funding_received" && mailing.awaiting_funding) throw new UserError("Record “Funding received” first.");
  const def = SIMULATED_EVENTS[event];
  const update: StatusUpdate = {
    source: "simulation",
    eventType: event,
    providerStatusRaw: def.raw,
    description: `Simulated: ${def.label}`,
  };
  if (event === "funding_received") update.awaitingFunding = false;
  if (event === "processing") update.mailingStatus = "processing";
  if (event === "mailed") {
    update.mailingStatus = "mailed";
    if (mailing.tracking_supported && !mailing.tracking_number) {
      update.trackingNumber = `SIM-${randomBytes(6).toString("hex").toUpperCase()}`;
    }
  }
  if (event === "in_transit") update.deliveryStatus = "in_transit";
  if (event === "delivered") update.deliveryStatus = "delivered";
  if (event === "delivery_exception") update.deliveryStatus = "delivery_exception";
  return applyStatusUpdate(ctx, mailing, update);
}

const reconcileSchema = z.object({
  resolution: z.enum(["confirmed_accepted", "confirmed_not_received"]),
  provider_reference: nullableText(200),
  notes: optionalText(1000),
});

/** Owner resolves a "Submission outcome unknown" record after checking the provider account. */
export async function reconcileUnknownSubmission(ctx: Ctx, mailingId: string, input: z.input<typeof reconcileSchema>) {
  parse(uuid, mailingId);
  const data = parse(reconcileSchema, input);
  const mailing = assertFound(await ctx.store.get("mailings", mailingId), "Mailing");
  if (mailing.mailing_status !== "submission_unknown") throw new UserError("Only unknown submissions need reconciliation.");
  if (data.resolution === "confirmed_accepted" && !data.provider_reference) {
    throw new UserError("Enter the provider reference you found in the provider account.");
  }
  const updated = assertFound(
    await ctx.store.update(
      "mailings",
      mailingId,
      data.resolution === "confirmed_accepted"
        ? {
            mailing_status: "accepted",
            provider_reference: data.provider_reference,
            accepted_at: nowIso(),
            unresolved_condition: null,
          }
        : {
            mailing_status: "failed",
            last_error: "Owner confirmed the provider did not receive this submission.",
            unresolved_condition: null,
          },
      { where: { mailing_status: "submission_unknown" } },
    ),
    "Mailing",
  );
  await ctx.store.insert("mailing_events", {
    owner_id: ctx.owner.id,
    client_id: mailing.client_id,
    mailing_id: mailingId,
    source: "owner",
    event_type: "reconciled",
    provider_status_raw: null,
    mailing_status: updated.mailing_status,
    delivery_status: null,
    description:
      data.resolution === "confirmed_accepted"
        ? "Owner confirmed with the provider that the submission was received."
        : "Owner confirmed with the provider that the submission was not received.",
    occurred_at: null,
    details: data.notes ? { notes: data.notes } : {},
  });
  await recordAudit(ctx, {
    action: "mailing.reconciled",
    record_type: "mailing",
    record_id: mailingId,
    client_id: mailing.client_id,
    case_id: mailing.case_id,
    summary: `Unknown submission reconciled manually: ${data.resolution.replace(/_/g, " ")}`,
    metadata: { notes: data.notes },
  });
  return updated;
}

const manualSchema = z.object({
  service: z.enum(["first_class", "certified"]),
  provider_label: optionalText(80),
  external_reference: nullableText(200),
  mailing_status: z.enum(["accepted", "processing", "mailed"]),
  mailed_date: optionalDate,
  tracking_number: nullableText(80),
  actual_cost: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? Math.round(Number(s) * 100) : null))
    .refine((n) => n === null || (Number.isFinite(n) && n >= 0), "Enter a valid cost."),
  notes: optionalText(1000),
});

/** When the API is unavailable: record a mailing you sent another way. Labelled "Manually recorded". */
export async function recordManualMailing(ctx: Ctx, packetId: string, input: z.input<typeof manualSchema>) {
  parse(uuid, packetId);
  const data = parse(manualSchema, input);
  const packet = assertFound(await ctx.store.get("mailing_packets", packetId), "Packet");
  if (packet.status !== "approved") throw new UserError("Approve the packet before recording how it was mailed.");
  const existing = (await ctx.store.list("mailings", { packet_id: packetId }))[0];
  if (existing) throw new UserError("This packet already has a mailing record.");
  const letter = assertFound(await ctx.store.get("letters", packet.letter_id), "Letter");
  const mailedAt = data.mailed_date ? `${data.mailed_date}T12:00:00.000Z` : null;
  let mailing: MailingRow;
  try {
    mailing = await ctx.store.insert("mailings", {
      owner_id: ctx.owner.id,
      client_id: packet.client_id,
      case_id: packet.case_id,
      packet_id: packet.id,
      idempotency_key: idempotencyKeyFor(packet.id),
      mail_mode: "manual",
      provider: "manual",
      record_origin: "manually_recorded",
      service: data.service,
      return_receipt: packet.mail_options.return_receipt,
      recipient_snapshot: packet.recipient_snapshot,
      page_count: packet.page_count,
      mailing_status: data.mailing_status,
      delivery_status: data.tracking_number ? "unknown" : "not_available",
      response_status: letter.expects_response ? "awaiting_response" : "not_expected",
      provider_status_raw: data.provider_label ? `Manually recorded (${data.provider_label})` : "Manually recorded",
      provider_reference: data.external_reference,
      tracking_number: data.tracking_number,
      tracking_supported: Boolean(data.tracking_number),
      quote_cents: null,
      actual_cost_cents: data.actual_cost,
      cost_currency: data.actual_cost !== null ? "USD" : null,
      awaiting_funding: false,
      submission_started_at: null,
      submitted_at: mailedAt,
      accepted_at: null,
      mailed_at: data.mailing_status === "mailed" ? mailedAt ?? nowIso() : null,
      delivered_at: null,
      last_status_refresh_at: null,
      last_error: null,
      unresolved_condition: null,
    });
  } catch (err) {
    if (err instanceof StoreError && err.code === "unique_violation") throw new UserError("This packet already has a mailing record.");
    throw err;
  }
  await ctx.store.update("letters", letter.id, { locked_at: nowIso() });
  await ctx.store.insert("mailing_events", {
    owner_id: ctx.owner.id,
    client_id: mailing.client_id,
    mailing_id: mailing.id,
    source: "owner",
    event_type: "manual_record",
    provider_status_raw: null,
    mailing_status: mailing.mailing_status,
    delivery_status: null,
    description: "Mailing manually recorded (not API verified).",
    occurred_at: mailedAt,
    details: data.notes ? { notes: data.notes } : {},
  });
  await recordAudit(ctx, {
    action: "mailing.manual_recorded",
    record_type: "mailing",
    record_id: mailing.id,
    client_id: mailing.client_id,
    case_id: mailing.case_id,
    summary: `Mailing manually recorded (${data.mailing_status}) — not API verified`,
    metadata: { notes: data.notes },
  });
  return mailing;
}

const manualUpdateSchema = z.object({
  mailing_status: z.enum(MAILING_STATUSES).optional(),
  delivery_status: z.enum(DELIVERY_STATUSES).optional(),
  tracking_number: nullableText(80),
  note: optionalText(500),
});

export async function updateManualMailing(ctx: Ctx, mailingId: string, input: z.input<typeof manualUpdateSchema>) {
  parse(uuid, mailingId);
  const data = parse(manualUpdateSchema, input);
  const mailing = assertFound(await ctx.store.get("mailings", mailingId), "Mailing");
  if (mailing.provider !== "manual") {
    throw new UserError("Provider-tracked mailings are updated from provider reports, not manually.");
  }
  return applyStatusUpdate(ctx, mailing, {
    source: "owner",
    eventType: "manual_update",
    providerStatusRaw: null,
    mailingStatus: data.mailing_status,
    deliveryStatus: data.delivery_status,
    trackingNumber: data.tracking_number ?? undefined,
    description: data.note ? `Manual update: ${data.note}` : "Manual status update",
  });
}

export async function getMailingBundle(ctx: Ctx, mailingId: string) {
  if (!uuid.safeParse(mailingId).success) return null;
  const mailing = await ctx.store.get("mailings", mailingId);
  if (!mailing) return null;
  const [packet, client, kase, events, responses, followUps, audit] = await Promise.all([
    ctx.store.get("mailing_packets", mailing.packet_id),
    ctx.store.get("clients", mailing.client_id),
    ctx.store.get("cases", mailing.case_id),
    ctx.store.list("mailing_events", { mailing_id: mailingId }),
    ctx.store.list("responses", { mailing_id: mailingId }),
    ctx.store.list("follow_ups", { mailing_id: mailingId }),
    ctx.store.list("audit_events", { record_id: mailingId }),
  ]);
  const letter = packet ? await ctx.store.get("letters", packet.letter_id) : null;
  return {
    mailing,
    packet: packet!,
    letter,
    client: client!,
    kase: kase!,
    events: events.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
    responses: responses.sort((a, b) => b.received_date.localeCompare(a.received_date)),
    followUps,
    audit: audit.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
  };
}
