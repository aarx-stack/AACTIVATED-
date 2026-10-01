import { describe, expect, it } from "vitest";
import { createDraftFromPacket, setAttachments, updateLetter } from "@/server/services/letters";
import { submitMailing } from "@/server/services/mailings";
import { approvePacket, preparePacket } from "@/server/services/packets";
import { uploadDocument } from "@/server/services/documents";
import { buildApprovedPacket, buildLetter, makeCtx, samplePdf } from "../support/fixtures";
import type { Ctx } from "@/server/services/ctx";
import type { LetterRow } from "@/server/types";

async function edit(ctx: Ctx, letter: LetterRow, patch: Partial<LetterRow>) {
  const l = { ...(await ctx.store.get("letters", letter.id))!, ...patch };
  return updateLetter(ctx, l.id, {
    title: l.title,
    letter_type: l.letter_type,
    sender_address: l.sender_address,
    recipient_name: l.recipient_name,
    recipient_address: l.recipient_address,
    body: l.body,
    mail_options: l.mail_options,
    expects_response: l.expects_response,
  });
}

describe("editing an approved packet invalidates approval", () => {
  it.each([
    ["letter body", { body: "Different text." }],
    ["recipient address", { recipient_address: { line1: "9 Other Rd", city: "Demo City", state: "CA", postal_code: "90000" } }],
    ["mailing options", { mail_options: { service: "certified" as const, return_receipt: true } }],
    ["sender", { sender_address: { name: "Someone Else", line1: "1 St", city: "X", state: "CA", postal_code: "90000" } }],
  ])("changing the %s", async (_label, patch) => {
    const ctx = makeCtx();
    const { packet, letter } = await buildApprovedPacket(ctx);
    await edit(ctx, letter, patch as Partial<LetterRow>);
    const after = (await ctx.store.get("mailing_packets", packet.id))!;
    expect(after.status).toBe("invalidated");
    expect((await ctx.store.get("letters", letter.id))!.status).toBe("draft");
    await expect(
      submitMailing(ctx, { packetId: packet.id, packetHash: packet.packet_hash, confirmFinal: true, acknowledgeCharges: true }),
    ).rejects.toThrow(/approved packet/);
  });

  it("changing or reordering attachments", async () => {
    const ctx = makeCtx();
    const { packet, letter, client, kase, doc } = await buildApprovedPacket(ctx);
    const second = await uploadDocument(ctx, {
      client_id: client.id,
      case_id: kase.id,
      category: "correspondence",
      filename: "second.pdf",
      bytes: await samplePdf("Second"),
      demo_fictional_ack: true,
    });
    await setAttachments(ctx, letter.id, [second.id, doc!.id]);
    expect((await ctx.store.get("mailing_packets", packet.id))!.status).toBe("invalidated");
  });

  it("an invalidated packet cannot be approved", async () => {
    const ctx = makeCtx();
    const { letter } = await buildLetter(ctx);
    const pending = await preparePacket(ctx, letter.id);
    await edit(ctx, letter, { body: "new text" });
    await expect(approvePacket(ctx, pending.id, { packetHash: pending.packet_hash, reviewedPacket: true })).rejects.toThrow(/no longer current/);
  });

  it("approval records hash, time and approver, and packet content is immutable", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    expect(packet.status).toBe("approved");
    expect(packet.approved_by).toBe(ctx.owner.id);
    expect(packet.approved_at).toBeTruthy();
    expect(packet.packet_hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(ctx.store.update("mailing_packets", packet.id, { page_count: 99 })).rejects.toThrow(/immutable/);
    await expect(ctx.store.update("mailing_packets", packet.id, { status: "pending_review" })).rejects.toThrow();
    const audit = await ctx.store.list("audit_events", { action: "packet.approved" });
    expect(audit[0].metadata.packet_hash).toBe(packet.packet_hash);
  });

  it("packets include every attachment in order and an accurate page count", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    expect(packet.attachments_snapshot.map((a) => a.original_filename)).toEqual(["evidence.pdf"]);
    expect(packet.attachments_snapshot[0].page_count).toBe(2);
    expect(packet.page_count).toBe(3);
  });

  it("refuses packets with unreplaced [[placeholders]]", async () => {
    const ctx = makeCtx();
    const { letter } = await buildLetter(ctx);
    await edit(ctx, letter, { body: "Hello [[STATE THE FACTS]]" });
    await expect(preparePacket(ctx, letter.id)).rejects.toThrow(/placeholders/);
  });

  it("“Create new mailing from this packet” makes a new draft needing new approval", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    await submitMailing(ctx, { packetId: packet.id, packetHash: packet.packet_hash, confirmFinal: true, acknowledgeCharges: false });
    const copy = await createDraftFromPacket(ctx, packet.id);
    expect(copy.status).toBe("draft");
    expect(copy.locked_at).toBeNull();
    expect((await ctx.store.list("mailings")).length).toBe(1);
    expect((await ctx.store.list("letter_attachments", { letter_id: copy.id })).length).toBe(1);
  });
});
