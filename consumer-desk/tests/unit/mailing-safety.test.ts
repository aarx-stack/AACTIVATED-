import { afterEach, describe, expect, it, vi } from "vitest";
import { providerFor } from "@/server/mail";
import { LetterStreamProvider } from "@/server/mail/letterstream-provider";
import { MockMailProvider } from "@/server/mail/mock-provider";
import { UserError } from "@/server/services/errors";
import { updateLetter } from "@/server/services/letters";
import { recordSimulatedEvent, reconcileUnknownSubmission, submitMailing } from "@/server/services/mailings";
import { getConnectionState, testConnection } from "@/server/services/provider-health";
import { CONNECTED_ENV, buildApprovedPacket, makeCtx } from "../support/fixtures";

afterEach(() => vi.restoreAllMocks());

const confirm = (packet: { id: string; packet_hash: string }) => ({
  packetId: packet.id,
  packetHash: packet.packet_hash,
  confirmFinal: true,
  acknowledgeCharges: true,
});

describe("demo mode cannot submit real mail", () => {
  it("never constructs a real provider for demo data", () => {
    expect(() => new LetterStreamProvider("provider_test", {}, "demo")).toThrow();
    const ctx = makeCtx({ DATA_MODE: "demo", MAIL_MODE: "provider_test" });
    expect(providerFor(ctx.policy, ctx.config)).toBeNull();
  });

  it("rejects a submission when demo data is configured with a real mail mode", async () => {
    const ok = makeCtx();
    const { packet } = await buildApprovedPacket(ok);
    const bad = { ...makeCtx({ DATA_MODE: "demo", MAIL_MODE: "live", LIVE_MAILING_ENABLED: "true" }), store: ok.store };
    await expect(submitMailing(bad, confirm(packet))).rejects.toThrow(UserError);
    expect(await ok.store.list("mailings")).toHaveLength(0);
  });
});

describe("direct calls cannot bypass live-mailing restrictions", () => {
  it("blocks live mode without LIVE_MAILING_ENABLED and creates no record", async () => {
    const seed = makeCtx();
    const { packet } = await buildApprovedPacket(seed);
    const live = makeCtx({ ...CONNECTED_ENV, MAIL_MODE: "live" }, seed.store, false);
    await expect(submitMailing(live, confirm(packet))).rejects.toThrow(/LIVE_MAILING_ENABLED/);
    expect(await seed.store.list("mailings")).toHaveLength(0);
  });

  it("blocks LetterStream submission while its documentation is missing, without contacting it", async () => {
    const seed = makeCtx();
    const { packet } = await buildApprovedPacket(seed);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const test = makeCtx({ ...CONNECTED_ENV, MAIL_MODE: "provider_test" }, seed.store, false);
    await expect(submitMailing(test, confirm(packet))).rejects.toThrow(/Submission is not available/);
    const live = makeCtx({ ...CONNECTED_ENV, MAIL_MODE: "live", LIVE_MAILING_ENABLED: "true" }, seed.store, false);
    await expect(submitMailing(live, confirm(packet))).rejects.toThrow(UserError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await seed.store.list("mailings")).toHaveLength(0);
  });

  it("requires the exact approved packet hash and a final confirmation", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    await expect(submitMailing(ctx, { ...confirm(packet), packetHash: "0".repeat(64) })).rejects.toThrow(/not the current approved packet/);
    await expect(submitMailing(ctx, { ...confirm(packet), confirmFinal: false })).rejects.toThrow(/final send confirmation/);
    expect(await ctx.store.list("mailings")).toHaveLength(0);
  });
});

describe("missing credentials do not crash", () => {
  it("reports LetterStream as not configured and blocks verification without throwing", async () => {
    const ctx = makeCtx({ ...CONNECTED_ENV, MAIL_MODE: "provider_test" }, undefined, false);
    const state = await getConnectionState(ctx);
    expect(state.label).toBe("Not configured");
    expect(state.descriptor?.missingEnv).toEqual(["LETTERSTREAM_TEST_API_ID", "LETTERSTREAM_TEST_API_KEY", "LETTERSTREAM_TEST_BASE_URL"]);
    const result = await testConnection(ctx);
    expect(result.kind).toBe("blocked");
    expect((await getConnectionState(ctx)).label).toBe("Not configured");
  });

  it("never labels LetterStream Verified without a documented verification", async () => {
    const env = { LETTERSTREAM_TEST_API_ID: "id", LETTERSTREAM_TEST_API_KEY: "k", LETTERSTREAM_TEST_BASE_URL: "https://example.invalid" };
    Object.assign(process.env, env);
    try {
      const ctx = makeCtx({ ...CONNECTED_ENV, MAIL_MODE: "provider_test", ...env }, undefined, false);
      await testConnection(ctx);
      expect((await getConnectionState(ctx)).label).toBe("Configured but unverified");
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  });
});

describe("duplicate-send protection", () => {
  it("double-click / concurrent submissions create exactly one mailing and one provider call", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    const spy = vi.spyOn(MockMailProvider.prototype, "submit");
    const results = await Promise.all(Array.from({ length: 5 }, () => submitMailing(ctx, confirm(packet))));
    expect((await ctx.store.list("mailings")).length).toBe(1);
    expect(results.filter((r) => r.outcome === "accepted")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "duplicate")).toHaveLength(4);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the stored record is created before the provider is contacted", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    let seenDuringCall: string | undefined;
    vi.spyOn(MockMailProvider.prototype, "submit").mockImplementation(async () => {
      seenDuringCall = (await ctx.store.list("mailings"))[0]?.mailing_status;
      return { kind: "accepted", providerReference: "MOCK-1", providerStatusRaw: "SIMULATED_ACCEPTED", awaitingFunding: false, trackingNumber: null, costCents: null, costCurrency: null };
    });
    await submitMailing(ctx, confirm(packet));
    expect(seenDuringCall).toBe("submitting");
  });
});

describe("ambiguous failures never trigger automatic resend", () => {
  it("marks a timeout as submission_unknown and refuses to resend", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    const spy = vi.spyOn(MockMailProvider.prototype, "submit");
    const first = await submitMailing(ctx, { ...confirm(packet), simulate: "timeout" });
    expect(first.outcome).toBe("unknown");
    expect(first.mailing.mailing_status).toBe("submission_unknown");
    expect(first.mailing.unresolved_condition).toMatch(/Do not resend/);
    const second = await submitMailing(ctx, confirm(packet));
    expect(second.outcome).toBe("duplicate");
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(recordSimulatedEvent(ctx, first.mailing.id, "mailed")).rejects.toThrow(/Reconcile/);
  });

  it("treats a thrown network error as unknown, not as failed", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    vi.spyOn(MockMailProvider.prototype, "submit").mockRejectedValue(new Error("ECONNRESET"));
    const r = await submitMailing(ctx, confirm(packet));
    expect(r.mailing.mailing_status).toBe("submission_unknown");
  });

  it("lets the owner reconcile manually", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    const r = await submitMailing(ctx, { ...confirm(packet), simulate: "timeout" });
    await expect(reconcileUnknownSubmission(ctx, r.mailing.id, { resolution: "confirmed_accepted" })).rejects.toThrow(/reference/);
    const fixed = await reconcileUnknownSubmission(ctx, r.mailing.id, { resolution: "confirmed_accepted", provider_reference: "REF-123" });
    expect(fixed.mailing_status).toBe("accepted");
    expect(fixed.provider_reference).toBe("REF-123");
  });

  it("records a definitive rejection as failed without retrying", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    const spy = vi.spyOn(MockMailProvider.prototype, "submit");
    const r = await submitMailing(ctx, { ...confirm(packet), simulate: "reject" });
    expect(r.mailing.mailing_status).toBe("failed");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("accepted is not mailed", () => {
  it("keeps awaiting-funding jobs out of production and never auto-advances", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    const r = await submitMailing(ctx, { ...confirm(packet), simulate: "accept_awaiting_funding" });
    expect(r.mailing.mailing_status).toBe("accepted");
    expect(r.mailing.awaiting_funding).toBe(true);
    expect(r.mailing.mailed_at).toBeNull();
    await expect(recordSimulatedEvent(ctx, r.mailing.id, "processing")).rejects.toThrow(/Funding/);
  });

  it("does not fabricate tracking for First-Class", async () => {
    const ctx = makeCtx();
    const { packet } = await buildApprovedPacket(ctx);
    const r = await submitMailing(ctx, confirm(packet));
    expect(r.mailing.delivery_status).toBe("not_available");
    await recordSimulatedEvent(ctx, r.mailing.id, "mailed");
    await expect(recordSimulatedEvent(ctx, r.mailing.id, "delivered")).rejects.toThrow(/Tracking is not available/);
    expect((await ctx.store.get("mailings", r.mailing.id))!.tracking_number).toBeNull();
  });
});

describe("locked letters", () => {
  it("a mailed letter cannot be edited", async () => {
    const ctx = makeCtx();
    const { packet, letter } = await buildApprovedPacket(ctx);
    await submitMailing(ctx, confirm(packet));
    const current = (await ctx.store.get("letters", letter.id))!;
    await expect(
      updateLetter(ctx, letter.id, {
        title: current.title,
        letter_type: current.letter_type,
        sender_address: current.sender_address,
        recipient_name: current.recipient_name,
        recipient_address: current.recipient_address,
        body: current.body + " changed",
        mail_options: current.mail_options,
        expects_response: true,
      }),
    ).rejects.toThrow(/locked/);
  });
});
