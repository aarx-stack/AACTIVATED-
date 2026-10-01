import { assemblePacket, renderLetterPdf, type PacketPart } from "../pdf/pdf";
import type { AttachmentSnapshot, LetterRow, PacketRow } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError, assertFound } from "./errors";
import { canonicalJson, sha256Hex } from "./hash";
import { invalidateOpenPackets, recipientProblems } from "./letters";
import { activeProvider, recordProviderCall } from "./provider-health";
import { findPlaceholders, formatLongDate } from "./templates";
import { nowIso } from "./time";
import { assertNoSensitiveNumbers, parse, uuid } from "./validation";

async function loadAttachmentParts(ctx: Ctx, letter: LetterRow) {
  const rows = (await ctx.store.list("letter_attachments", { letter_id: letter.id })).sort(
    (a, b) => a.position - b.position,
  );
  const parts: PacketPart[] = [];
  const snapshots: Omit<AttachmentSnapshot, "page_count">[] = [];
  for (const a of rows) {
    const doc = assertFound(await ctx.store.get("documents", a.document_id), "Attached document");
    if (doc.client_id !== letter.client_id) throw new UserError("An attachment belongs to a different client.");
    const bytes = await ctx.store.getFile(doc.storage_path);
    if (!bytes) throw new UserError(`The file for "${doc.original_filename}" is missing from private storage.`);
    if (sha256Hex(bytes) !== doc.sha256) throw new UserError(`"${doc.original_filename}" changed in storage; re-upload it.`);
    parts.push({ bytes, mimeType: doc.mime_type, label: doc.original_filename });
    snapshots.push({
      document_id: doc.id,
      original_filename: doc.original_filename,
      mime_type: doc.mime_type,
      sha256: doc.sha256,
      position: a.position,
    });
  }
  return { parts, snapshots };
}

/** Renders the current draft letter only (no attachments). Used for "Generate PDF". */
export async function renderDraftLetterPdf(ctx: Ctx, letter: LetterRow): Promise<Uint8Array> {
  return renderLetterPdf({
    sender: letter.sender_address,
    recipientName: letter.recipient_name,
    recipient: letter.recipient_address,
    body: letter.body,
    dateLine: formatLongDate(new Date(), ctx.timezone),
  });
}

export function computePacketHash(p: {
  pdf_sha256: string;
  content_hash: string;
  sender: unknown;
  recipient: unknown;
  mail_options: unknown;
  attachments: unknown;
}): string {
  return sha256Hex(canonicalJson(p));
}

/**
 * Freezes the current letter into an immutable version and assembles the complete mailing
 * packet PDF (letter + attachments in order). The packet starts in "pending_review".
 */
export async function preparePacket(ctx: Ctx, letterId: string): Promise<PacketRow> {
  parse(uuid, letterId);
  const letter = assertFound(await ctx.store.get("letters", letterId), "Letter");
  if (letter.locked_at) throw new UserError("This letter already has a mailing record and is locked.");
  const client = assertFound(await ctx.store.get("clients", letter.client_id), "Client");

  if (!letter.body.trim()) throw new UserError("The letter body is empty.");
  const placeholders = findPlaceholders(letter.body);
  if (placeholders.length) {
    throw new UserError(`Replace the remaining placeholders before preparing the packet: ${placeholders.map((p) => `[[${p}]]`).join(", ")}`);
  }
  const missingRecipient = recipientProblems(letter.recipient_name, letter.recipient_address);
  if (missingRecipient.length) throw new UserError(`Recipient address is incomplete: ${missingRecipient.join(", ")}.`);
  const missingSender = recipientProblems(letter.sender_address.name ?? "", letter.sender_address);
  if (missingSender.length) throw new UserError(`Sender/return address is incomplete: ${missingSender.join(", ")}.`);
  assertNoSensitiveNumbers({ letter_body: letter.body });

  // Packets can always be built (for PDF export or manual mailing). Whether the active provider
  // supports the selected service is enforced at submission time.
  const letterPdf = await renderLetterPdf({
    sender: letter.sender_address,
    recipientName: letter.recipient_name,
    recipient: letter.recipient_address,
    body: letter.body,
    dateLine: formatLongDate(new Date(), ctx.timezone),
  });
  const { parts, snapshots } = await loadAttachmentParts(ctx, letter);
  const packetPdf = await assemblePacket([{ bytes: letterPdf, mimeType: "application/pdf", label: "Letter" }, ...parts]);
  const attachments: AttachmentSnapshot[] = snapshots.map((s, i) => ({ ...s, page_count: packetPdf.partPageCounts[i + 1] }));

  const recipientSnapshot = { ...letter.recipient_address, name: letter.recipient_name || letter.recipient_address.name };
  const senderSnapshot = { ...letter.sender_address };
  const versionNo = letter.current_version + 1;
  const contentHash = sha256Hex(
    canonicalJson({
      title: letter.title,
      body: letter.body,
      sender: senderSnapshot,
      recipient: recipientSnapshot,
      attachments: attachments.map((a) => ({ id: a.document_id, sha256: a.sha256, position: a.position })),
    }),
  );

  await invalidateOpenPackets(ctx, letter.id, "replaced by a newly generated packet");

  const version = await ctx.store.insert("letter_versions", {
    owner_id: ctx.owner.id,
    client_id: letter.client_id,
    letter_id: letter.id,
    version_no: versionNo,
    title: letter.title,
    body: letter.body,
    sender_address: senderSnapshot,
    recipient_name: letter.recipient_name,
    recipient_address: letter.recipient_address,
    attachments,
    content_hash: contentHash,
    status: "ready_for_review",
  });

  const packetId = crypto.randomUUID();
  const storagePath = `${ctx.owner.id}/packets/${packetId}.pdf`;
  const pdfSha = sha256Hex(packetPdf.bytes);
  await ctx.store.putFile(storagePath, packetPdf.bytes, "application/pdf");
  const packet = await ctx.store.insert("mailing_packets", {
    id: packetId,
    owner_id: ctx.owner.id,
    client_id: letter.client_id,
    case_id: letter.case_id,
    letter_id: letter.id,
    letter_version_id: version.id,
    storage_path: storagePath,
    pdf_sha256: pdfSha,
    packet_hash: computePacketHash({
      pdf_sha256: pdfSha,
      content_hash: contentHash,
      sender: senderSnapshot,
      recipient: recipientSnapshot,
      mail_options: letter.mail_options,
      attachments,
    }),
    page_count: packetPdf.pageCount,
    sender_snapshot: senderSnapshot,
    recipient_snapshot: recipientSnapshot,
    attachments_snapshot: attachments,
    mail_options: letter.mail_options,
    quote_cents: null,
    quote_currency: null,
    quote_source: null,
    quoted_at: null,
    is_test: client.is_test_record,
    status: "pending_review",
    approved_at: null,
    approved_by: null,
    invalidated_at: null,
    invalidation_reason: null,
  });
  await ctx.store.update("letters", letter.id, { status: "ready_for_review", current_version: versionNo });
  await recordAudit(ctx, {
    action: "packet.generated",
    record_type: "mailing_packet",
    record_id: packet.id,
    client_id: letter.client_id,
    case_id: letter.case_id,
    source: "system",
    summary: `Packet generated for review (v${versionNo}, ${packet.page_count} page${packet.page_count === 1 ? "" : "s"})`,
    metadata: { pdf_sha256: pdfSha, pages: packet.page_count, attachments: attachments.length },
  });
  return packet;
}

/** Requests a quote only when the active provider documents one. Never invents a price. */
export async function requestQuote(ctx: Ctx, packetId: string) {
  parse(uuid, packetId);
  const packet = assertFound(await ctx.store.get("mailing_packets", packetId), "Packet");
  const provider = activeProvider(ctx);
  if (!provider) throw new UserError(ctx.policy.blockedReason ?? "No provider available.");
  const descriptor = provider.descriptor();
  if (!descriptor.capabilities.quote.supported) {
    return { kind: "unavailable" as const, message: descriptor.capabilities.quote.basis };
  }
  if (packet.status !== "pending_review") {
    throw new UserError("Quotes can only be attached to a packet that is awaiting review.");
  }
  const bytes = assertFound(await ctx.store.getFile(packet.storage_path), "Packet PDF");
  const result = await provider.quote({
    packetId,
    pdf: bytes,
    pageCount: packet.page_count,
    sender: packet.sender_snapshot,
    recipient: packet.recipient_snapshot,
    options: packet.mail_options,
  });
  await recordProviderCall(ctx, descriptor, {
    operation: "quote",
    outcome: result.kind === "quote" ? "ok" : "blocked",
    message: result.kind === "quote" ? `${result.cents} ${result.currency}` : result.message,
  });
  if (result.kind === "quote") {
    await ctx.store.update("mailing_packets", packetId, {
      quote_cents: result.cents,
      quote_currency: result.currency,
      quote_source: result.source,
      quoted_at: nowIso(),
    });
  }
  return result;
}

export async function approvePacket(
  ctx: Ctx,
  packetId: string,
  input: { packetHash: string; reviewedPacket: boolean },
): Promise<PacketRow> {
  parse(uuid, packetId);
  if (!input.reviewedPacket) throw new UserError("Confirm that you reviewed the complete packet.");
  const packet = assertFound(await ctx.store.get("mailing_packets", packetId), "Packet");
  if (packet.status === "approved") return packet;
  if (packet.status !== "pending_review") {
    throw new UserError("This packet is no longer current (the letter changed). Generate a new packet and review it.");
  }
  if (input.packetHash !== packet.packet_hash) {
    throw new UserError("The packet changed after you opened it. Review it again before approving.");
  }
  const letter = assertFound(await ctx.store.get("letters", packet.letter_id), "Letter");
  const version = assertFound(await ctx.store.get("letter_versions", packet.letter_version_id), "Letter version");
  if (letter.current_version !== version.version_no || letter.status !== "ready_for_review") {
    throw new UserError("The letter changed after this packet was generated. Generate a new packet.");
  }
  const provider = activeProvider(ctx);
  if (provider?.descriptor().capabilities.quote.supported && packet.quote_cents === null) {
    throw new UserError("Get the current quote before approving this packet.");
  }
  const approved = await ctx.store.update(
    "mailing_packets",
    packetId,
    { status: "approved", approved_at: nowIso(), approved_by: ctx.owner.id },
    { where: { status: "pending_review", packet_hash: input.packetHash } },
  );
  if (!approved) throw new UserError("The packet changed while you were approving it. Review it again.");
  await ctx.store.update("letters", letter.id, { status: "approved" });
  await recordAudit(ctx, {
    action: "packet.approved",
    record_type: "mailing_packet",
    record_id: packetId,
    client_id: packet.client_id,
    case_id: packet.case_id,
    summary: `Packet approved (${packet.page_count} pages, ${packet.mail_options.service.replace("_", "-")})`,
    metadata: {
      packet_hash: packet.packet_hash,
      pdf_sha256: packet.pdf_sha256,
      service: packet.mail_options.service,
      return_receipt: packet.mail_options.return_receipt,
      recipient_city: packet.recipient_snapshot.city ?? "",
      recipient_state: packet.recipient_snapshot.state ?? "",
      quote_cents: packet.quote_cents,
    },
  });
  return approved;
}

export async function getPacketBundle(ctx: Ctx, packetId: string) {
  if (!uuid.safeParse(packetId).success) return null;
  const packet = await ctx.store.get("mailing_packets", packetId);
  if (!packet) return null;
  const [letter, version, client, kase, mailings] = await Promise.all([
    ctx.store.get("letters", packet.letter_id),
    ctx.store.get("letter_versions", packet.letter_version_id),
    ctx.store.get("clients", packet.client_id),
    ctx.store.get("cases", packet.case_id),
    ctx.store.list("mailings", { packet_id: packetId }),
  ]);
  return { packet, letter: letter!, version: version!, client: client!, kase: kase!, mailing: mailings[0] ?? null };
}

/** Returns packet PDF bytes after verifying they still match the approved hash. */
export async function getPacketPdf(ctx: Ctx, packetId: string) {
  if (!uuid.safeParse(packetId).success) return null;
  const packet = await ctx.store.get("mailing_packets", packetId);
  if (!packet || packet.owner_id !== ctx.owner.id) return null;
  const bytes = await ctx.store.getFile(packet.storage_path);
  if (!bytes) return null;
  if (sha256Hex(bytes) !== packet.pdf_sha256) throw new UserError("Stored packet PDF does not match its recorded hash.");
  return { packet, bytes };
}
