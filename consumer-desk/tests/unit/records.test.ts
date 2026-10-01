import { describe, expect, it } from "vitest";
import { addNote, createCase, createClient, deleteClient } from "@/server/services/clients";
import { detectMime, uploadDocument, validateUpload } from "@/server/services/documents";
import { createLetter, setAttachments } from "@/server/services/letters";
import { submitMailing } from "@/server/services/mailings";
import { createFollowUp, recordResponse } from "@/server/services/responses";
import { StoreError } from "@/server/store/types";
import { TINY_PNG, buildApprovedPacket, encryptedPdf, makeCtx, samplePdf } from "../support/fixtures";

describe("one record cannot use another record's attachments", () => {
  it("rejects attaching another client's document (service and store level)", async () => {
    const ctx = makeCtx();
    const a = await createClient(ctx, { full_name: "Client A (fictional)" });
    const b = await createClient(ctx, { full_name: "Client B (fictional)" });
    const caseA = await createCase(ctx, a.id, { title: "A case" });
    const caseB = await createCase(ctx, b.id, { title: "B case" });
    const docB = await uploadDocument(ctx, {
      client_id: b.id,
      case_id: caseB.id,
      category: "supporting_evidence",
      filename: "b.pdf",
      bytes: await samplePdf("B"),
      demo_fictional_ack: true,
    });
    const letterA = await createLetter(ctx, { client_id: a.id, case_id: caseA.id });
    await expect(setAttachments(ctx, letterA.id, [docB.id])).rejects.toThrow(/does not belong/);
    // Bypassing the service: the store (like the database FK) refuses the cross-client link.
    await expect(
      ctx.store.insert("letter_attachments", { owner_id: ctx.owner.id, client_id: a.id, letter_id: letterA.id, document_id: docB.id, position: 0 }),
    ).rejects.toBeInstanceOf(StoreError);
    await expect(
      ctx.store.insert("letter_attachments", { owner_id: ctx.owner.id, client_id: b.id, letter_id: letterA.id, document_id: docB.id, position: 0 }),
    ).rejects.toBeInstanceOf(StoreError);
    // A letter cannot be created on another client's case.
    await expect(createLetter(ctx, { client_id: a.id, case_id: caseB.id })).rejects.toThrow(/different client/);
  });

  it("rejects a response linked to another client's mailing", async () => {
    const ctx = makeCtx();
    const one = await buildApprovedPacket(ctx, { name: "One (fictional)" });
    const two = await buildApprovedPacket(ctx, { name: "Two (fictional)" });
    const sent = await submitMailing(ctx, { packetId: one.packet.id, packetHash: one.packet.packet_hash, confirmFinal: true, acknowledgeCharges: false });
    await expect(
      recordResponse(ctx, { client_id: two.client.id, case_id: two.kase.id, mailing_id: sent.mailing.id, received_date: "2026-09-30" }),
    ).rejects.toThrow(/different client/);
    await expect(
      createFollowUp(ctx, { client_id: two.client.id, case_id: one.kase.id, title: "x", due_date: "2026-10-01" }),
    ).rejects.toThrow(/different client/);
  });
});

describe("upload validation", () => {
  it("detects real file types from content, not the name", async () => {
    expect(detectMime(await samplePdf())).toBe("application/pdf");
    expect(detectMime(TINY_PNG)).toBe("image/png");
    expect(detectMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectMime(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("rejects mismatched extensions, encrypted, malformed and oversized files", async () => {
    await expect(validateUpload(await samplePdf(), "evidence.png")).rejects.toThrow(/does not match/);
    await expect(validateUpload(await encryptedPdf(), "locked.pdf")).rejects.toThrow(/Encrypted/);
    await expect(validateUpload(new TextEncoder().encode("%PDF-1.7 garbage"), "bad.pdf")).rejects.toThrow(/could not be read/);
    await expect(validateUpload(new TextEncoder().encode("MZ executable"), "x.pdf")).rejects.toThrow(/Only PDF/);
    await expect(validateUpload(new Uint8Array(11 * 1024 * 1024), "big.pdf")).rejects.toThrow(/10 MB/);
    const ok = await validateUpload(TINY_PNG, "photo.PNG");
    expect(ok.mime).toBe("image/png");
  });

  it("demo mode refuses uploads without the fictional-content acknowledgement and uses safe storage names", async () => {
    const ctx = makeCtx();
    const c = await createClient(ctx, { full_name: "Demo (fictional)" });
    await expect(
      uploadDocument(ctx, { client_id: c.id, category: "authorization", filename: "id.pdf", bytes: await samplePdf() }),
    ).rejects.toThrow(/fictional/);
    const doc = await uploadDocument(ctx, {
      client_id: c.id,
      category: "correspondence",
      filename: "../../etc/pass wd.pdf",
      bytes: await samplePdf(),
      demo_fictional_ack: true,
    });
    expect(doc.storage_path).toMatch(new RegExp(`^${ctx.owner.id}/${c.id}/[0-9a-f-]{36}\\.pdf$`));
    expect(doc.original_filename).toBe("pass wd.pdf");
  });
});

describe("sensitive data guardrails", () => {
  it("refuses full SSNs and full account numbers; allows last four", async () => {
    const ctx = makeCtx();
    await expect(createClient(ctx, { full_name: "X", notes: "SSN 123-45-6789" })).rejects.toThrow(/Social Security/);
    const c = await createClient(ctx, { full_name: "Y" });
    await expect(createCase(ctx, c.id, { title: "Card", description: "card 4111 1111 1111 1111" })).rejects.toThrow(/account or card/);
    await expect(createCase(ctx, c.id, { title: "Bad", account_last4: "12345" })).rejects.toThrow(/last four/);
    const ok = await createCase(ctx, c.id, { title: "Good", account_last4: "1234" });
    expect(ok.account_last4).toBe("1234");
    await expect(addNote(ctx, c.id, { body: "acct 123456789012" })).rejects.toThrow();
  });
});

describe("deletion requires confirmation and keeps mailing history", () => {
  it("requires the exact name and refuses clients with mailings", async () => {
    const ctx = makeCtx();
    const { client, packet } = await buildApprovedPacket(ctx);
    await expect(deleteClient(ctx, client.id, "wrong")).rejects.toThrow(/exactly/);
    await submitMailing(ctx, { packetId: packet.id, packetHash: packet.packet_hash, confirmFinal: true, acknowledgeCharges: false });
    await expect(deleteClient(ctx, client.id, client.full_name)).rejects.toThrow(/Archive/);
    const other = await createClient(ctx, { full_name: "Delete Me (fictional)" });
    await deleteClient(ctx, other.id, "Delete Me (fictional)");
    expect(await ctx.store.get("clients", other.id)).toBeNull();
    expect((await ctx.store.list("audit_events", { action: "client.deleted" })).length).toBe(1);
  });
});
