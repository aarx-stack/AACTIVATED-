"use server";

import { randomBytes } from "node:crypto";
import type { ActionState } from "@/lib/action-state";
import { act, address, bool, str } from "@/server/actions-helpers";
import { resetDemoStore } from "@/server/store/demo-instance";
import { createCase, createClient } from "@/server/services/clients";
import { UserError, assertFound } from "@/server/services/errors";
import { createLetter, recipientProblems, updateLetter } from "@/server/services/letters";
import { preparePacket } from "@/server/services/packets";
import { testConnection } from "@/server/services/provider-health";
import { saveSettings } from "@/server/services/settings";
import { formatLongDate } from "@/server/services/templates";
import { todayIn } from "@/server/services/time";

export async function saveSettingsAction(_p: ActionState, fd: FormData) {
  return act("settings.save", async (ctx) => {
    await saveSettings(ctx, {
      app_name: str(fd, "app_name"),
      accent_primary: str(fd, "accent_primary"),
      accent_highlight: str(fd, "accent_highlight"),
      accent_violet: str(fd, "accent_violet"),
      timezone: str(fd, "timezone"),
      return_address: address(fd, "return"),
    });
    return { message: "Settings saved." };
  });
}

export async function testConnectionAction(_p: ActionState) {
  void _p;
  return act(
    "provider.test",
    async (ctx) => {
      const result = await testConnection(ctx);
      if (result.kind !== "ok") throw new UserError(result.message);
      return { message: result.message };
    },
    { limit: 10 },
  );
}

export async function resetDemoAction(_p: ActionState, fd: FormData) {
  return act("demo.reset", async (ctx) => {
    if (!ctx.isDemo) throw new UserError("Only demo data can be reset.");
    if (!bool(fd, "confirm")) throw new UserError("Tick the confirmation box.");
    await resetDemoStore();
    return { redirectTo: "/?reset=1" };
  });
}

// ---------------------------------------------------------------------------------------------
// Test mailing wizard
// ---------------------------------------------------------------------------------------------

export async function createTestRecordAction(_p: ActionState, fd: FormData) {
  return act("wizard.test_record", async (ctx) => {
    const name = str(fd, "full_name").trim();
    if (!name) throw new UserError("Enter your own name for the test record.");
    const client = await createClient(ctx, {
      full_name: `TEST RECORD — ${name}`,
      email: null,
      notes: "Integration test record for testing the mailing workflow with your own details. Not a client.",
      tags: ["test-record"],
      preferred_contact: "none",
      is_test_record: true,
    });
    const kase = await createCase(ctx, client.id, {
      title: "Mailing integration test",
      category: "integration_test",
      description: "Created by the LetterStream Test Center wizard.",
      organization: "",
      status: "open",
      next_action: "Run the test mailing wizard",
    });
    return { redirectTo: `/test-center/wizard?client=${client.id}&case=${kase.id}` };
  });
}

export async function wizardCreateLetterAction(_p: ActionState, fd: FormData) {
  return act("wizard.letter", async (ctx) => {
    const client = assertFound(await ctx.store.get("clients", str(fd, "client_id")), "Test record");
    if (!client.is_test_record) throw new UserError("The test wizard only works with a TEST RECORD.");
    const kase = assertFound(await ctx.store.get("cases", str(fd, "case_id")), "Test case");
    if (kase.client_id !== client.id) throw new UserError("Case does not belong to the test record.");

    const recipient = address(fd, "recipient");
    const sender = address(fd, "sender");
    const missing = recipientProblems(recipient.name, recipient);
    if (missing.length) throw new UserError(`Enter your own test recipient details: ${missing.join(", ")}.`);
    if (!bool(fd, "own_address")) throw new UserError("Confirm the recipient is yourself (your own address).");

    const today = todayIn(ctx.timezone).replace(/-/g, "");
    const testId = `CD-TEST-${today}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const dateLine = formatLongDate(new Date(), ctx.timezone);
    const city = (a: { city?: string; state?: string }) => [a.city, a.state].filter(Boolean).join(", ");
    const body = [
      "LETTERSTREAM INTEGRATION TEST",
      "",
      "This is a system integration test generated from Consumer Desk.",
      "",
      `Date: ${dateLine}`,
      `Test ID: ${testId}`,
      `Sender: ${sender.name}${city(sender) ? `, ${city(sender)}` : ""}`,
      `Recipient: ${recipient.name}${city(recipient) ? `, ${city(recipient)}` : ""}`,
      "",
      "No action is required. This letter does not concern any account, dispute or other person.",
    ].join("\n");

    const letter = await createLetter(ctx, {
      client_id: client.id,
      case_id: kase.id,
      title: `Integration test ${testId}`,
    });
    await updateLetter(ctx, letter.id, {
      title: `Integration test ${testId}`,
      letter_type: "integration_test",
      sender_address: sender,
      recipient_name: recipient.name,
      recipient_address: recipient,
      body: str(fd, "body").trim() ? str(fd, "body") : body,
      mail_options: { service: "first_class", return_receipt: false },
      expects_response: false,
    });
    const packet = await preparePacket(ctx, letter.id);
    return { redirectTo: `/test-center/wizard?packet=${packet.id}` };
  });
}

export async function wizardSetServiceAction(_p: ActionState, fd: FormData) {
  return act("wizard.service", async (ctx) => {
    const packet = assertFound(await ctx.store.get("mailing_packets", str(fd, "packet_id")), "Packet");
    const letter = assertFound(await ctx.store.get("letters", packet.letter_id), "Letter");
    const service = str(fd, "service") === "certified" ? "certified" : "first_class";
    const options = { service, return_receipt: service === "certified" && bool(fd, "return_receipt") } as const;
    if (JSON.stringify(options) === JSON.stringify(packet.mail_options)) {
      return { redirectTo: `/test-center/wizard?packet=${packet.id}&step=quote` };
    }
    // Changing the mailing option changes the packet, so it is regenerated and must be re-reviewed.
    await updateLetter(ctx, letter.id, {
      title: letter.title,
      letter_type: letter.letter_type,
      sender_address: letter.sender_address,
      recipient_name: letter.recipient_name,
      recipient_address: letter.recipient_address,
      body: letter.body,
      mail_options: options,
      expects_response: letter.expects_response,
    });
    const next = await preparePacket(ctx, letter.id);
    return { redirectTo: `/test-center/wizard?packet=${next.id}&step=quote` };
  });
}

export async function saveProfileAction(_p: ActionState, fd: FormData) {
  return act("profile.save", async (ctx) => {
    if (ctx.isDemo) throw new UserError("The demo owner profile is fictional and cannot be edited.");
    const displayName = str(fd, "display_name").trim().slice(0, 120);
    const { createSupabaseServerClient } = await import("@/server/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("users").update({ display_name: displayName }).eq("id", ctx.owner.id);
    if (error) throw new UserError("Could not update the owner profile.");
    return { message: "Profile updated." };
  });
}
