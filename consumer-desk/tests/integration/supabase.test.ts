/**
 * Integration tests against a REAL local Supabase stack (Postgres + RLS + Auth + Storage).
 * Run with:  npm run test:supabase   (requires `npx supabase start`)
 * Skipped automatically when the SUPABASE_TEST_* variables are not set.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { readConfig, resolveMailPolicy } from "@/server/config";
import type { Ctx } from "@/server/services/ctx";
import { createCase, createClient as createConsumerClient } from "@/server/services/clients";
import { uploadDocument } from "@/server/services/documents";
import { createLetter, updateLetter } from "@/server/services/letters";
import { submitMailing } from "@/server/services/mailings";
import { computeMetrics, loadDataset } from "@/server/services/metrics";
import { todayIn } from "@/server/services/time";
import { PRIVATE_BUCKET, SupabaseStore } from "@/server/store/supabase-store";
import { StoreError } from "@/server/store/types";
import { buildApprovedPacket, samplePdf } from "../support/fixtures";

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY!;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!;
const DB_URL = process.env.SUPABASE_TEST_DB_URL!;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const PASSWORD = `Test-${randomUUID()}-9`;

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL!, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
}

function ctxFor(client: SupabaseClient, ownerId: string, email: string): Ctx {
  const config = readConfig({
    NODE_ENV: "test",
    DATA_MODE: "supabase",
    MAIL_MODE: "mock",
    SUPABASE_URL: URL,
    SUPABASE_ANON_KEY: ANON,
    OWNER_EMAIL: email,
  });
  return {
    store: new SupabaseStore(client),
    owner: { id: ownerId, email, displayName: "Integration Owner" },
    config,
    policy: resolveMailPolicy(config),
    timezone: "America/Los_Angeles",
    isDemo: false,
  };
}

function psql(sql: string) {
  return execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8" }).trim();
}

describe.skipIf(!URL)("connected app against local Supabase", () => {
  const ownerEmail = `owner-${randomUUID().slice(0, 8)}@example.test`;
  const intruderEmail = `intruder-${randomUUID().slice(0, 8)}@example.test`;
  let ownerId = "";
  let intruderId = "";
  let owner: SupabaseClient;
  let ctx: Ctx;

  beforeAll(async () => {
    const admin = createClient(URL!, SERVICE, opts);
    const o = await admin.auth.admin.createUser({ email: ownerEmail, password: PASSWORD, email_confirm: true });
    const i = await admin.auth.admin.createUser({ email: intruderEmail, password: PASSWORD, email_confirm: true });
    if (o.error || i.error) throw o.error ?? i.error;
    ownerId = o.data.user.id;
    intruderId = i.data.user.id;
    const reg = await admin.from("users").insert({ id: ownerId, email: ownerEmail, role: "owner" });
    if (reg.error) throw reg.error;
    owner = await signedIn(ownerEmail);
    ctx = ctxFor(owner, ownerId, ownerEmail);
  });

  it("public sign-up is disabled", async () => {
    const anon = createClient(URL!, ANON, opts);
    const { data, error } = await anon.auth.signUp({ email: `new-${randomUUID().slice(0, 6)}@example.test`, password: PASSWORD });
    expect(error ?? data.user === null).toBeTruthy();
  });

  it("runs the journey with real persistence that survives a fresh session", async () => {
    const { client, packet } = await buildApprovedPacket(ctx, { name: "Integration Client (fictional)" });
    const sent = await submitMailing(ctx, { packetId: packet.id, packetHash: packet.packet_hash, confirmFinal: true, acknowledgeCharges: false });
    expect(sent.outcome).toBe("accepted");

    // "Refresh" / restart: a brand-new client and session sees the same saved records.
    const fresh = ctxFor(await signedIn(ownerEmail), ownerId, ownerEmail);
    const reloaded = await fresh.store.get("clients", client.id);
    expect(reloaded?.full_name).toBe("Integration Client (fictional)");
    const mailings = await fresh.store.list("mailings", { client_id: client.id });
    expect(mailings).toHaveLength(1);
    expect(mailings[0].mailing_status).toBe("accepted");
    const metrics = computeMetrics(await loadDataset(fresh), todayIn("America/Los_Angeles"));
    expect(metrics.find((m) => m.key === "submitted")!.count).toBeGreaterThanOrEqual(1);
  });

  it("rejects anonymous access to records and private files", async () => {
    const doc = await uploadDocumentFor(ctx);
    const anon = createClient(URL!, ANON, opts);
    const { data, error } = await anon.from("clients").select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const dl = await anon.storage.from(PRIVATE_BUCKET).download(doc.storage_path);
    expect(dl.data).toBeNull();
    const pub = await fetch(`${URL}/storage/v1/object/public/${PRIVATE_BUCKET}/${doc.storage_path}`);
    expect(pub.ok).toBe(false);
    // The owner can read it through an authenticated session.
    const ownDl = await owner.storage.from(PRIVATE_BUCKET).download(doc.storage_path);
    expect(ownDl.data).not.toBeNull();
  });

  it("an authenticated non-owner account sees and changes nothing", async () => {
    const doc = await uploadDocumentFor(ctx);
    const intruder = await signedIn(intruderEmail);
    expect((await intruder.from("clients").select("*")).data ?? []).toHaveLength(0);
    expect((await intruder.from("documents").select("*")).data ?? []).toHaveLength(0);
    expect((await intruder.from("audit_events").select("*")).data ?? []).toHaveLength(0);
    const ins = await intruder.from("clients").insert({ owner_id: intruderId, full_name: "Intruder" });
    expect(ins.error).not.toBeNull();
    const promote = await intruder.from("users").insert({ id: intruderId, email: intruderEmail, role: "owner" });
    expect(promote.error).not.toBeNull();
    expect((await intruder.storage.from(PRIVATE_BUCKET).download(doc.storage_path)).data).toBeNull();
    const up = await intruder.storage.from(PRIVATE_BUCKET).upload(`${intruderId}/x.pdf`, await samplePdf(), { contentType: "application/pdf" });
    expect(up.error).not.toBeNull();
  });

  it("the owner cannot write outside their own storage folder", async () => {
    const up = await owner.storage.from(PRIVATE_BUCKET).upload(`${intruderId}/sneaky.pdf`, await samplePdf(), { contentType: "application/pdf" });
    expect(up.error).not.toBeNull();
  });

  it("the database refuses cross-client attachment links even through direct API calls", async () => {
    const a = await createConsumerClient(ctx, { full_name: "FK A (fictional)" });
    const b = await createConsumerClient(ctx, { full_name: "FK B (fictional)" });
    const caseA = await createCase(ctx, a.id, { title: "A" });
    const docB = await uploadDocumentFor(ctx, b.id);
    const letterA = await createLetter(ctx, { client_id: a.id, case_id: caseA.id });
    const err = await ctx.store
      .insert("letter_attachments", { owner_id: ownerId, client_id: a.id, letter_id: letterA.id, document_id: docB.id, position: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("foreign_key_violation");
  });

  it("enforces packet immutability, approved-only mailings and one mailing per packet", async () => {
    const { packet, kase, client } = await buildApprovedPacket(ctx, { name: "Guards (fictional)" });
    await expect(ctx.store.update("mailing_packets", packet.id, { page_count: 42 })).rejects.toMatchObject({ code: "rule_violation" });
    // Concurrent submissions → one mailing, guaranteed by the database unique constraint.
    const results = await Promise.all(
      [1, 2, 3].map(() => submitMailing(ctx, { packetId: packet.id, packetHash: packet.packet_hash, confirmFinal: true, acknowledgeCharges: false })),
    );
    expect(results.filter((r) => r.outcome === "accepted")).toHaveLength(1);
    expect((await ctx.store.list("mailings", { packet_id: packet.id })).length).toBe(1);
    const direct = await owner.from("mailings").insert({
      owner_id: ownerId,
      client_id: client.id,
      case_id: kase.id,
      packet_id: packet.id,
      idempotency_key: `packet:${packet.id}-dup`,
      mail_mode: "mock",
      provider: "mock",
      record_origin: "simulated",
      service: "first_class",
      recipient_snapshot: {},
      page_count: 1,
    });
    expect(direct.error?.code).toBe("23505");
    // A mailed packet cannot be invalidated, and the letter is locked.
    await expect(ctx.store.update("mailing_packets", packet.id, { status: "invalidated" })).rejects.toMatchObject({ code: "rule_violation" });
    const letter = (await ctx.store.get("letters", packet.letter_id))!;
    await expect(
      updateLetter(ctx, letter.id, {
        title: letter.title,
        letter_type: letter.letter_type,
        sender_address: letter.sender_address,
        recipient_name: letter.recipient_name,
        recipient_address: letter.recipient_address,
        body: "edited after mailing",
        mail_options: letter.mail_options,
        expects_response: true,
      }),
    ).rejects.toThrow(/locked/);
    const raw = await owner.from("letters").update({ body: "direct edit" }).eq("id", letter.id);
    expect(raw.error?.code).toBe("P0001");
  });

  it("audit events are append-only", async () => {
    const [event] = await ctx.store.list("audit_events");
    const upd = await owner.from("audit_events").update({ summary: "tampered" }).eq("id", event.id).select();
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const del = await owner.from("audit_events").delete().eq("id", event.id).select();
    expect((del.data ?? []).length).toBe(0);
    expect((await ctx.store.get("audit_events", event.id))?.summary).toBe(event.summary);
  });

  it("requires MFA (aal2) for record access once a verified factor exists", async () => {
    const before = (await owner.from("clients").select("id")).data ?? [];
    expect(before.length).toBeGreaterThan(0);
    const factorId = randomUUID();
    psql(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
       values ('${factorId}', '${ownerId}', 'test-${factorId.slice(0, 6)}', 'totp', 'verified', now(), now(), 'x')`,
    );
    try {
      const after = (await owner.from("clients").select("id")).data ?? [];
      expect(after).toHaveLength(0);
    } finally {
      psql(`delete from auth.mfa_factors where id = '${factorId}'`);
    }
    expect(((await owner.from("clients").select("id")).data ?? []).length).toBe(before.length);
  });
});

async function uploadDocumentFor(ctx: Ctx, clientId?: string) {
  const id = clientId ?? (await createConsumerClient(ctx, { full_name: `Doc owner ${randomUUID().slice(0, 4)} (fictional)` })).id;
  return uploadDocument(ctx, {
    client_id: id,
    category: "supporting_evidence",
    filename: "private.pdf",
    bytes: await samplePdf("Private"),
  });
}
