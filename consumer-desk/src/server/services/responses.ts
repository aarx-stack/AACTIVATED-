import { z } from "zod";
import { FOLLOW_UP_KINDS, RESPONSE_RECORD_STATUSES, type FollowUpRow, type ResponseRow } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { uploadDocument } from "./documents";
import { UserError, assertFound } from "./errors";
import { nowIso } from "./time";
import { assertNoSensitiveNumbers, isoDate, optionalDate, optionalText, parse, requiredText, uuid } from "./validation";

const optionalId = z
  .string()
  .optional()
  .nullable()
  .transform((s) => (s && s.trim() ? s.trim() : null))
  .refine((s) => s === null || uuid.safeParse(s).success, "Invalid identifier.");

const responseSchema = z.object({
  client_id: uuid,
  case_id: uuid,
  mailing_id: optionalId,
  received_date: isoDate,
  sender_name: optionalText(200),
  notes: optionalText(20000),
  next_action: optionalText(500),
  follow_up_date: optionalDate,
});

/** Keeps mailing.response_status in step with its linked responses (latest response wins). */
export async function syncMailingResponseStatus(ctx: Ctx, mailingId: string) {
  const mailing = await ctx.store.get("mailings", mailingId);
  if (!mailing) return;
  const responses = (await ctx.store.list("responses", { mailing_id: mailingId })).sort((a, b) =>
    (b.received_date + b.created_at).localeCompare(a.received_date + a.created_at),
  );
  let status = mailing.response_status;
  if (responses.length > 0) status = responses[0].status;
  else {
    const packet = await ctx.store.get("mailing_packets", mailing.packet_id);
    const letter = packet ? await ctx.store.get("letters", packet.letter_id) : null;
    status = letter?.expects_response === false ? "not_expected" : "awaiting_response";
  }
  if (status !== mailing.response_status) await ctx.store.update("mailings", mailingId, { response_status: status });
}

export interface RecordResponseInput extends z.input<typeof responseSchema> {
  file?: { filename: string; bytes: Uint8Array } | null;
  demo_fictional_ack?: boolean;
}

export async function recordResponse(ctx: Ctx, input: RecordResponseInput): Promise<ResponseRow> {
  const data = parse(responseSchema, input);
  assertNoSensitiveNumbers({ notes: data.notes });
  const client = assertFound(await ctx.store.get("clients", data.client_id), "Client");
  const kase = assertFound(await ctx.store.get("cases", data.case_id), "Case");
  if (kase.client_id !== client.id) throw new UserError("That case belongs to a different client.");
  if (data.mailing_id) {
    const m = assertFound(await ctx.store.get("mailings", data.mailing_id), "Outgoing mailing");
    if (m.client_id !== client.id || m.case_id !== kase.id) {
      throw new UserError("The selected outgoing mailing belongs to a different client or case.");
    }
  }
  let documentId: string | null = null;
  if (input.file && input.file.bytes.length > 0) {
    const doc = await uploadDocument(ctx, {
      client_id: client.id,
      case_id: kase.id,
      category: "response",
      description: data.sender_name ? `Response from ${data.sender_name}` : "Response",
      filename: input.file.filename,
      bytes: input.file.bytes,
      demo_fictional_ack: input.demo_fictional_ack,
    });
    documentId = doc.id;
  }
  const row = await ctx.store.insert("responses", {
    owner_id: ctx.owner.id,
    client_id: client.id,
    case_id: kase.id,
    mailing_id: data.mailing_id,
    document_id: documentId,
    received_date: data.received_date,
    sender_name: data.sender_name,
    notes: data.notes,
    status: "review_needed",
    next_action: data.next_action,
    follow_up_date: data.follow_up_date,
    reviewed_at: null,
  });
  if (row.mailing_id) await syncMailingResponseStatus(ctx, row.mailing_id);
  await recordAudit(ctx, {
    action: "response.recorded",
    record_type: "response",
    record_id: row.id,
    client_id: client.id,
    case_id: kase.id,
    summary: `Response received${row.sender_name ? ` from ${row.sender_name}` : ""} (${row.received_date})`,
    metadata: { mailing_id: row.mailing_id, has_file: Boolean(documentId) },
  });
  if (data.follow_up_date) {
    await createFollowUp(ctx, {
      client_id: client.id,
      case_id: kase.id,
      mailing_id: row.mailing_id,
      response_id: row.id,
      kind: "review_response",
      title: data.next_action || "Review response",
      due_date: data.follow_up_date,
      notes: "",
    });
  }
  return row;
}

const responseUpdateSchema = z.object({
  status: z.enum(RESPONSE_RECORD_STATUSES),
  notes: optionalText(20000),
  next_action: optionalText(500),
  follow_up_date: optionalDate,
});

export async function updateResponse(ctx: Ctx, responseId: string, input: z.input<typeof responseUpdateSchema>) {
  parse(uuid, responseId);
  const data = parse(responseUpdateSchema, input);
  assertNoSensitiveNumbers({ notes: data.notes });
  const existing = assertFound(await ctx.store.get("responses", responseId), "Response");
  const becameReviewed =
    existing.status !== data.status && ["reviewed", "follow_up_required", "resolved"].includes(data.status) && !existing.reviewed_at;
  const row = assertFound(
    await ctx.store.update("responses", responseId, {
      ...data,
      reviewed_at: becameReviewed ? nowIso() : existing.reviewed_at,
    }),
    "Response",
  );
  if (row.mailing_id) await syncMailingResponseStatus(ctx, row.mailing_id);
  await recordAudit(ctx, {
    action: becameReviewed ? "response.reviewed" : "response.updated",
    record_type: "response",
    record_id: responseId,
    client_id: row.client_id,
    case_id: row.case_id,
    summary: becameReviewed ? `Response reviewed (${row.status.replace(/_/g, " ")})` : `Response updated (${row.status.replace(/_/g, " ")})`,
  });
  if (data.follow_up_date && data.follow_up_date !== existing.follow_up_date) {
    await createFollowUp(ctx, {
      client_id: row.client_id,
      case_id: row.case_id,
      mailing_id: row.mailing_id,
      response_id: row.id,
      kind: "review_response",
      title: data.next_action || "Follow up on response",
      due_date: data.follow_up_date,
      notes: "",
    });
  }
  return row;
}

// ---------------------------------------------------------------------------------------------
// Follow-ups: owner-set review reminders. Never legal deadlines, never automatic actions.
// ---------------------------------------------------------------------------------------------

const followUpSchema = z.object({
  client_id: uuid,
  case_id: optionalId,
  mailing_id: optionalId,
  response_id: optionalId,
  kind: z.enum(FOLLOW_UP_KINDS).default("other"),
  title: requiredText(200, "Follow-up title"),
  due_date: isoDate,
  notes: optionalText(2000),
});

export async function createFollowUp(ctx: Ctx, input: z.input<typeof followUpSchema>): Promise<FollowUpRow> {
  const data = parse(followUpSchema, input);
  const client = assertFound(await ctx.store.get("clients", data.client_id), "Client");
  for (const [table, id] of [
    ["cases", data.case_id],
    ["mailings", data.mailing_id],
    ["responses", data.response_id],
  ] as const) {
    if (!id) continue;
    const ref = assertFound(await ctx.store.get(table, id), "Linked record");
    if (ref.client_id !== client.id) throw new UserError("A linked record belongs to a different client.");
  }
  const row = await ctx.store.insert("follow_ups", { ...data, owner_id: ctx.owner.id, completed_at: null });
  await recordAudit(ctx, {
    action: "follow_up.created",
    record_type: "follow_up",
    record_id: row.id,
    client_id: row.client_id,
    case_id: row.case_id,
    summary: `Follow-up set for ${row.due_date}: ${row.title}`,
  });
  return row;
}

export async function setFollowUpDone(ctx: Ctx, id: string, done: boolean) {
  parse(uuid, id);
  const row = assertFound(await ctx.store.get("follow_ups", id), "Follow-up");
  const updated = assertFound(await ctx.store.update("follow_ups", id, { completed_at: done ? nowIso() : null }), "Follow-up");
  await recordAudit(ctx, {
    action: done ? "follow_up.completed" : "follow_up.reopened",
    record_type: "follow_up",
    record_id: id,
    client_id: row.client_id,
    case_id: row.case_id,
    summary: `${done ? "Follow-up completed" : "Follow-up reopened"}: ${row.title}`,
  });
  return updated;
}
