import { z } from "zod";
import type { Address, LetterRow, MailOptions } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError, assertFound } from "./errors";
import { getSettings } from "./settings";
import { applyTokens, getTemplate } from "./templates";
import { nowIso } from "./time";
import { addressSchema, assertNoSensitiveNumbers, optionalText, parse, requiredText, uuid } from "./validation";

const mailOptionsSchema = z.object({
  service: z.enum(["first_class", "certified"]).default("first_class"),
  return_receipt: z.boolean().default(false),
});

const letterContentSchema = z.object({
  title: requiredText(200, "Letter title"),
  letter_type: optionalText(60).transform((s) => s || "general"),
  sender_address: addressSchema,
  recipient_name: optionalText(200),
  recipient_address: addressSchema,
  body: optionalText(100000),
  mail_options: mailOptionsSchema,
  expects_response: z.boolean().default(true),
});
export type LetterContentInput = z.input<typeof letterContentSchema>;

function normalizeOptions(o: MailOptions): MailOptions {
  // Return receipt only applies to Certified.
  return { service: o.service, return_receipt: o.service === "certified" ? o.return_receipt : false };
}

/**
 * Invalidates every packet for this letter that is awaiting review or approved but not mailed.
 * Called whenever the letter, its attachments, address or mailing options change.
 */
export async function invalidateOpenPackets(ctx: Ctx, letterId: string, reason: string): Promise<number> {
  const packets = await ctx.store.list("mailing_packets", { letter_id: letterId });
  if (packets.length === 0) return 0;
  const mailings = await ctx.store.list("mailings", { client_id: packets[0].client_id });
  let count = 0;
  for (const p of packets) {
    if (p.status === "invalidated") continue;
    if (mailings.some((m) => m.packet_id === p.id)) continue;
    await ctx.store.update("mailing_packets", p.id, {
      status: "invalidated",
      invalidated_at: nowIso(),
      invalidation_reason: reason,
    });
    count++;
    await recordAudit(ctx, {
      action: "packet.invalidated",
      record_type: "mailing_packet",
      record_id: p.id,
      client_id: p.client_id,
      case_id: p.case_id,
      source: "system",
      summary: `Packet ${p.status === "approved" ? "approval" : "review"} invalidated: ${reason}`,
    });
  }
  return count;
}

export interface CreateLetterInput extends Partial<LetterContentInput> {
  client_id: string;
  case_id: string;
  template_id?: string | null;
}

export async function createLetter(ctx: Ctx, input: CreateLetterInput): Promise<LetterRow> {
  parse(uuid, input.client_id);
  parse(uuid, input.case_id);
  const client = assertFound(await ctx.store.get("clients", input.client_id), "Client");
  const kase = assertFound(await ctx.store.get("cases", input.case_id), "Case");
  if (kase.client_id !== client.id) throw new UserError("That case belongs to a different client.");

  const settings = await getSettings(ctx);
  let body = input.body ?? "";
  let letterType = input.letter_type ?? "general";
  if (input.template_id) {
    const template = assertFound(await getTemplate(ctx, input.template_id), "Template");
    body = applyTokens(template.body, client, kase, ctx.timezone);
    letterType = template.letter_type;
  }
  const data = parse(letterContentSchema, {
    title: input.title ?? `${kase.title} — letter`,
    letter_type: letterType,
    sender_address: input.sender_address ?? settings.return_address ?? {},
    recipient_name: input.recipient_name ?? kase.organization ?? "",
    recipient_address: input.recipient_address ?? {},
    body,
    mail_options: input.mail_options ?? { service: "first_class", return_receipt: false },
    expects_response: input.expects_response ?? true,
  });
  assertNoSensitiveNumbers({ letter_body: data.body });

  const row = await ctx.store.insert("letters", {
    ...data,
    mail_options: normalizeOptions(data.mail_options),
    owner_id: ctx.owner.id,
    client_id: client.id,
    case_id: kase.id,
    status: "draft",
    current_version: 0,
    copied_from_packet_id: null,
    locked_at: null,
  });
  await recordAudit(ctx, {
    action: "letter.created",
    record_type: "letter",
    record_id: row.id,
    client_id: client.id,
    case_id: kase.id,
    summary: `Letter drafted: ${row.title}`,
  });
  return row;
}

export async function updateLetter(ctx: Ctx, letterId: string, input: LetterContentInput): Promise<LetterRow> {
  parse(uuid, letterId);
  const existing = assertFound(await ctx.store.get("letters", letterId), "Letter");
  if (existing.locked_at) {
    throw new UserError("This letter has a mailing record and is locked. Use “Create new mailing from this packet”.");
  }
  const data = parse(letterContentSchema, input);
  assertNoSensitiveNumbers({ letter_body: data.body });
  const next = { ...data, mail_options: normalizeOptions(data.mail_options) };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (k) => JSON.stringify(existing[k]) !== JSON.stringify(next[k]),
  );
  if (changed.length === 0) return existing;
  const contentChanged = changed.some((k) => k !== "letter_type" && k !== "expects_response");
  if (contentChanged) await invalidateOpenPackets(ctx, letterId, `letter changed (${changed.join(", ")})`);
  const row = assertFound(
    await ctx.store.update("letters", letterId, { ...next, ...(contentChanged ? { status: "draft" as const } : {}) }),
    "Letter",
  );
  await recordAudit(ctx, {
    action: "letter.edited",
    record_type: "letter",
    record_id: letterId,
    client_id: row.client_id,
    case_id: row.case_id,
    summary: "Letter edited",
    metadata: { fields: changed },
  });
  return row;
}

/** Replaces the attachment list with the given documents, in the given order. */
export async function setAttachments(ctx: Ctx, letterId: string, documentIds: string[]): Promise<void> {
  parse(uuid, letterId);
  const letter = assertFound(await ctx.store.get("letters", letterId), "Letter");
  if (letter.locked_at) throw new UserError("This letter has a mailing record and is locked.");
  const unique = [...new Set(documentIds)];
  if (unique.length !== documentIds.length) throw new UserError("A document can only be attached once.");
  if (unique.length > 25) throw new UserError("Attach at most 25 documents.");
  for (const id of unique) {
    parse(uuid, id);
    const doc = await ctx.store.get("documents", id);
    // Same-client rule: a letter can only carry that client's own documents.
    if (!doc || doc.client_id !== letter.client_id) {
      throw new UserError("One of the selected documents does not belong to this letter's client.");
    }
  }
  const existing = (await ctx.store.list("letter_attachments", { letter_id: letterId })).sort(
    (a, b) => a.position - b.position,
  );
  if (JSON.stringify(existing.map((a) => a.document_id)) === JSON.stringify(unique)) return;

  await invalidateOpenPackets(ctx, letterId, "attachments changed");
  for (const a of existing) await ctx.store.remove("letter_attachments", a.id);
  for (const [position, document_id] of unique.entries()) {
    await ctx.store.insert("letter_attachments", {
      owner_id: ctx.owner.id,
      client_id: letter.client_id,
      letter_id: letterId,
      document_id,
      position,
    });
  }
  await ctx.store.update("letters", letterId, { status: "draft" });
  await recordAudit(ctx, {
    action: "letter.attachments_changed",
    record_type: "letter",
    record_id: letterId,
    client_id: letter.client_id,
    case_id: letter.case_id,
    summary: `Attachments updated (${unique.length})`,
  });
}

export async function getLetterBundle(ctx: Ctx, letterId: string) {
  if (!uuid.safeParse(letterId).success) return null;
  const letter = await ctx.store.get("letters", letterId);
  if (!letter) return null;
  const [client, kase, attachmentRows, clientDocs, packets, mailings] = await Promise.all([
    ctx.store.get("clients", letter.client_id),
    ctx.store.get("cases", letter.case_id),
    ctx.store.list("letter_attachments", { letter_id: letterId }),
    ctx.store.list("documents", { client_id: letter.client_id }),
    ctx.store.list("mailing_packets", { letter_id: letterId }),
    ctx.store.list("mailings", { client_id: letter.client_id }),
  ]);
  const attachments = attachmentRows
    .sort((a, b) => a.position - b.position)
    .map((a) => ({ ...a, document: clientDocs.find((d) => d.id === a.document_id)! }))
    .filter((a) => a.document);
  const sortedPackets = packets.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const packetIds = new Set(sortedPackets.map((p) => p.id));
  const letterMailings = mailings.filter((m) => packetIds.has(m.packet_id));
  return {
    letter,
    client: client!,
    kase: kase!,
    attachments,
    clientDocuments: clientDocs.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    packets: sortedPackets,
    currentPacket: sortedPackets.find((p) => p.status !== "invalidated") ?? null,
    mailings: letterMailings,
  };
}

export function recipientProblems(name: string, a: Address): string[] {
  const problems: string[] = [];
  if (!name.trim() && !(a.name ?? "").trim()) problems.push("recipient name");
  if (!(a.line1 ?? "").trim()) problems.push("street address");
  if (!(a.city ?? "").trim()) problems.push("city");
  if (!(a.state ?? "").trim()) problems.push("state");
  if (!(a.postal_code ?? "").trim()) problems.push("ZIP code");
  return problems;
}

/**
 * “Create new mailing from this packet”: copies the packet's approved content into a brand-new
 * draft letter. Nothing is sent; the new draft needs its own packet review and approval.
 */
export async function createDraftFromPacket(ctx: Ctx, packetId: string): Promise<LetterRow> {
  parse(uuid, packetId);
  const packet = assertFound(await ctx.store.get("mailing_packets", packetId), "Packet");
  const version = assertFound(await ctx.store.get("letter_versions", packet.letter_version_id), "Letter version");
  const original = assertFound(await ctx.store.get("letters", packet.letter_id), "Letter");
  const row = await ctx.store.insert("letters", {
    owner_id: ctx.owner.id,
    client_id: packet.client_id,
    case_id: packet.case_id,
    title: `${version.title} (new mailing)`,
    letter_type: original.letter_type,
    sender_address: version.sender_address,
    recipient_name: version.recipient_name,
    recipient_address: version.recipient_address,
    body: version.body,
    mail_options: packet.mail_options,
    expects_response: original.expects_response,
    status: "draft",
    current_version: 0,
    copied_from_packet_id: packet.id,
    locked_at: null,
  });
  const docs = await ctx.store.list("documents", { client_id: packet.client_id });
  let position = 0;
  for (const a of [...packet.attachments_snapshot].sort((x, y) => x.position - y.position)) {
    if (!docs.some((d) => d.id === a.document_id)) continue;
    await ctx.store.insert("letter_attachments", {
      owner_id: ctx.owner.id,
      client_id: packet.client_id,
      letter_id: row.id,
      document_id: a.document_id,
      position: position++,
    });
  }
  await recordAudit(ctx, {
    action: "letter.created",
    record_type: "letter",
    record_id: row.id,
    client_id: row.client_id,
    case_id: row.case_id,
    summary: "New draft created from an earlier packet (requires new review and approval)",
    metadata: { source_packet: packet.id },
  });
  return row;
}
