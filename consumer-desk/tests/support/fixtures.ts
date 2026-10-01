import { PDFDocument, StandardFonts } from "pdf-lib";
import { readConfig, resolveMailPolicy, type EnvLike } from "@/server/config";
import type { Ctx } from "@/server/services/ctx";
import { createCase, createClient } from "@/server/services/clients";
import { uploadDocument } from "@/server/services/documents";
import { createLetter, setAttachments, updateLetter } from "@/server/services/letters";
import { approvePacket, preparePacket } from "@/server/services/packets";
import { DemoStore } from "@/server/store/demo-store";
import type { Store } from "@/server/store/types";

export const OWNER = { id: "00000000-0000-4000-8000-00000000d3e0", email: "owner@example.invalid", displayName: "Test Owner" };

export function makeCtx(env: EnvLike = { DATA_MODE: "demo", MAIL_MODE: "mock" }, store: Store = new DemoStore(), isDemo?: boolean): Ctx {
  const config = readConfig({ NODE_ENV: "test", ...env });
  return {
    store,
    owner: OWNER,
    config,
    policy: resolveMailPolicy(config),
    timezone: "America/Los_Angeles",
    isDemo: isDemo ?? config.dataMode === "demo",
  };
}

export const CONNECTED_ENV = {
  DATA_MODE: "supabase",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  OWNER_EMAIL: "owner@example.invalid",
};

export async function samplePdf(text = "Sample", pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`${text} ${i + 1}`, { x: 72, y: 700, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

/** A PDF whose trailer declares encryption, which must be rejected. */
export async function encryptedPdf(): Promise<Uint8Array> {
  const bytes = await samplePdf("Encrypted");
  const text = Buffer.from(bytes).toString("latin1").replace("trailer\n<<", "trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 >>");
  return new Uint8Array(Buffer.from(text, "latin1"));
}

// 1x1 transparent PNG
export const TINY_PNG = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

export const RECIPIENT = {
  name: "Sample Recipient Co. (fictional)",
  line1: "1 Example Way",
  line2: "Suite 2",
  city: "Demo City",
  state: "CA",
  postal_code: "90000",
  country: "US",
};
export const SENDER = { name: "Test Owner", line1: "2 Sample St", line2: "", city: "Demo City", state: "CA", postal_code: "90000", country: "US" };

export async function buildLetter(ctx: Ctx, opts: { name?: string; attach?: boolean } = {}) {
  const client = await createClient(ctx, { full_name: opts.name ?? "Pat Example (fictional)", city: "Demo City", state: "CA" });
  const kase = await createCase(ctx, client.id, { title: "Example case", organization: "Sample Recipient Co. (fictional)" });
  const letter = await createLetter(ctx, { client_id: client.id, case_id: kase.id, title: "Test letter" });
  await updateLetter(ctx, letter.id, {
    title: "Test letter",
    letter_type: "general",
    sender_address: SENDER,
    recipient_name: RECIPIENT.name,
    recipient_address: RECIPIENT,
    body: "To whom it may concern:\n\nThis is fictional test content.\n\nSincerely,\nPat",
    mail_options: { service: "first_class", return_receipt: false },
    expects_response: true,
  });
  let doc = null;
  if (opts.attach !== false) {
    doc = await uploadDocument(ctx, {
      client_id: client.id,
      case_id: kase.id,
      category: "supporting_evidence",
      filename: "evidence.pdf",
      bytes: await samplePdf("Evidence", 2),
      demo_fictional_ack: true,
    });
    await setAttachments(ctx, letter.id, [doc.id]);
  }
  return { client, kase, letter: (await ctx.store.get("letters", letter.id))!, doc };
}

export async function buildApprovedPacket(ctx: Ctx, opts: { name?: string } = {}) {
  const built = await buildLetter(ctx, opts);
  const pending = await preparePacket(ctx, built.letter.id);
  const packet = await approvePacket(ctx, pending.id, { packetHash: pending.packet_hash, reviewedPacket: true });
  return { ...built, packet };
}
