import { describe, expect, it } from "vitest";
import { createCase, createClient, exportClient } from "@/server/services/clients";
import { uploadDocument } from "@/server/services/documents";
import { createLetter, setAttachments, updateLetter } from "@/server/services/letters";
import { recordSimulatedEvent, refreshMailingStatus, submitMailing } from "@/server/services/mailings";
import { METRICS, computeMetrics, filterTrackerRows, loadDataset, trackerRows } from "@/server/services/metrics";
import { approvePacket, getPacketPdf, preparePacket } from "@/server/services/packets";
import { createFollowUp, recordResponse, updateResponse } from "@/server/services/responses";
import { clientTimeline } from "@/server/services/timeline";
import { todayIn } from "@/server/services/time";
import { inspectPdf } from "@/server/pdf/pdf";
import { seedDemo } from "@/server/store/demo-seed";
import { DemoStore } from "@/server/store/demo-store";
import { RECIPIENT, SENDER, makeCtx, samplePdf } from "../support/fixtures";

describe("core journey (service level)", () => {
  it("client → case → document → letter → packet → approve → simulated mailing → history → response → follow-up → timeline", async () => {
    const ctx = makeCtx();
    const today = todayIn(ctx.timezone);
    const count = async (key: string) => computeMetrics(await loadDataset(ctx), today).find((m) => m.key === key)!.count;

    const client = await createClient(ctx, { full_name: "Journey Test (fictional)", address_line1: "1 Example St", city: "Demo City", state: "CA", postal_code: "90000" });
    const kase = await createCase(ctx, client.id, { title: "Journey case", organization: "Example Org (fictional)" });
    const doc = await uploadDocument(ctx, {
      client_id: client.id,
      case_id: kase.id,
      category: "supporting_evidence",
      filename: "support.pdf",
      bytes: await samplePdf("Support"),
      demo_fictional_ack: true,
    });
    const letter = await createLetter(ctx, { client_id: client.id, case_id: kase.id, template_id: "starter-general" });
    expect(letter.body).toContain("Journey Test (fictional)");
    await updateLetter(ctx, letter.id, {
      title: "Journey letter",
      letter_type: "correspondence",
      sender_address: SENDER,
      recipient_name: RECIPIENT.name,
      recipient_address: RECIPIENT,
      body: "Re: Journey case\n\nTo whom it may concern:\n\nFictional facts written by the owner.\n\nSincerely,\nJourney Test",
      mail_options: { service: "certified", return_receipt: true },
      expects_response: true,
    });
    await setAttachments(ctx, letter.id, [doc.id]);
    expect(await count("draft_letters")).toBe(1);

    const pending = await preparePacket(ctx, letter.id);
    expect(await count("awaiting_approval")).toBe(1);
    const pdf = await getPacketPdf(ctx, pending.id);
    expect((await inspectPdf(pdf!.bytes)).pageCount).toBe(pending.page_count);

    const approved = await approvePacket(ctx, pending.id, { packetHash: pending.packet_hash, reviewedPacket: true });
    expect(await count("ready_to_send")).toBe(1);

    const sent = await submitMailing(ctx, { packetId: approved.id, packetHash: approved.packet_hash, confirmFinal: true, acknowledgeCharges: false });
    expect(sent.outcome).toBe("accepted");
    expect(sent.mailing.record_origin).toBe("simulated");
    expect(sent.mailing.provider_reference).toMatch(/^MOCK-/);
    expect(await count("submitted")).toBe(1);
    expect(await count("mailed")).toBe(0);

    const refresh = await refreshMailingStatus(ctx, sent.mailing.id);
    expect(refresh.ok).toBe(true);
    for (const e of ["processing", "mailed", "in_transit", "delivered"] as const) await recordSimulatedEvent(ctx, sent.mailing.id, e);
    const mailed = (await ctx.store.get("mailings", sent.mailing.id))!;
    expect(mailed.tracking_number).toMatch(/^SIM-/);
    expect(mailed.provider_status_raw).toBe("SIMULATED_DELIVERED");
    expect(await count("delivered")).toBe(1);
    expect(await count("awaiting_response")).toBe(1);

    const rows = trackerRows(await loadDataset(ctx), today, ctx.timezone, "Owner");
    expect(filterTrackerRows(rows, "delivered", "").map((r) => r.mailingId)).toEqual([sent.mailing.id]);
    expect(filterTrackerRows(rows, "all", mailed.tracking_number!)).toHaveLength(1);

    const response = await recordResponse(ctx, {
      client_id: client.id,
      case_id: kase.id,
      mailing_id: sent.mailing.id,
      received_date: today,
      sender_name: "Example Org (fictional)",
      notes: "Fictional reply",
    });
    expect(await count("responses_received")).toBe(1);
    expect(await count("review_needed")).toBe(1);
    expect(await count("awaiting_response")).toBe(0);
    await updateResponse(ctx, response.id, { status: "reviewed", notes: "Reviewed", next_action: "Call client" });
    expect(await count("review_needed")).toBe(0);
    expect((await ctx.store.get("mailings", sent.mailing.id))!.response_status).toBe("reviewed");

    await createFollowUp(ctx, { client_id: client.id, case_id: kase.id, mailing_id: sent.mailing.id, title: "Contact client", due_date: today, kind: "contact_client" });
    expect(await count("follow_ups_due")).toBe(1);

    const timeline = await clientTimeline(ctx, client.id);
    const actions = timeline.map((t) => t.action);
    for (const a of [
      "client.created",
      "case.created",
      "document.uploaded",
      "letter.created",
      "packet.generated",
      "packet.approved",
      "mailing.submitted",
      "provider.accepted",
      "provider.status_changed",
      "tracking.updated",
      "response.recorded",
      "response.reviewed",
      "follow_up.created",
    ]) {
      expect(actions).toContain(a);
    }
    expect(actions.indexOf("client.created")).toBeLessThan(actions.indexOf("mailing.submitted"));
    expect(timeline.filter((t) => t.source === "simulation").length).toBeGreaterThan(0);
    expect(timeline.filter((t) => t.source === "provider").length).toBe(0); // nothing was provider-reported

    const exported = await exportClient(ctx, client.id);
    expect(JSON.stringify(exported)).not.toContain("storage_path");
  });
});

describe("dashboard counts match the underlying records", () => {
  it("every metric's count equals its drill-down list and an independent count", async () => {
    const store = new DemoStore();
    await seedDemo(store);
    const ctx = makeCtx(undefined, store);
    const ds = await loadDataset(ctx);
    const today = todayIn(ctx.timezone);
    const metrics = computeMetrics(ds, today);
    for (const m of metrics) expect(m.count).toBe(METRICS.find((d) => d.key === m.key)!.select(ds, today).length);
    const by = Object.fromEntries(metrics.map((m) => [m.key, m.count]));
    expect(by.total_clients).toBe(ds.clients.filter((c) => !c.archived_at).length);
    expect(by.active_cases).toBe(ds.cases.filter((c) => c.status !== "closed").length);
    expect(by.closed_cases).toBe(ds.cases.filter((c) => c.status === "closed").length);
    expect(by.responses_received).toBe(ds.responses.length);
    expect(by.draft_letters).toBe(ds.letters.filter((l) => l.status === "draft").length);
    expect(by.follow_ups_due).toBe(ds.followUps.filter((f) => !f.completed_at && f.due_date <= today).length);
    expect(by.total_clients).toBe(3);
  });
});
