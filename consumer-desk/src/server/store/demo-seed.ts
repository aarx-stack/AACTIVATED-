import { readConfig, resolveMailPolicy } from "../config";
import { renderFictionalSamplePdf } from "../pdf/pdf";
import type { Ctx } from "../services/ctx";
import { createCase, createClient } from "../services/clients";
import { uploadDocument } from "../services/documents";
import { createLetter, setAttachments, updateLetter } from "../services/letters";
import { recordSimulatedEvent, submitMailing } from "../services/mailings";
import { approvePacket, preparePacket } from "../services/packets";
import { createFollowUp, recordResponse } from "../services/responses";
import { saveSettings } from "../services/settings";
import { addDays, todayIn } from "../services/time";
import type { Store } from "./types";

export const DEMO_OWNER = {
  id: "00000000-0000-4000-8000-00000000d3e0",
  email: "demo-owner@example.invalid",
  displayName: "Demo Owner (fictional)",
};

export function demoCtx(store: Store): Ctx {
  const config = readConfig({ DATA_MODE: "demo", MAIL_MODE: "mock", NODE_ENV: process.env.NODE_ENV });
  return {
    store,
    owner: DEMO_OWNER,
    config,
    policy: resolveMailPolicy(config),
    timezone: "America/Los_Angeles",
    isDemo: true,
  };
}

const fictionalAddress = (line1: string) => ({
  address_line1: line1,
  address_line2: null,
  city: "Demo City",
  state: "CA",
  postal_code: "90000",
  country: "US",
});

/**
 * Seeds three clearly fictional clients. All names, organisations and addresses are invented;
 * emails use the reserved example.com domain and phone numbers the fictional 555-01xx range.
 * Every mailing is produced by the mock provider and labelled simulated.
 */
export async function seedDemo(store: Store): Promise<void> {
  const ctx = demoCtx(store);
  const today = todayIn(ctx.timezone);

  await saveSettings(ctx, {
    app_name: "Consumer Desk",
    accent_primary: "#3578FF",
    accent_highlight: "#35E7FF",
    accent_violet: "#8B5CF6",
    timezone: "America/Los_Angeles",
    return_address: {
      name: "Demo Owner (fictional)",
      line1: "1 Example Plaza, Suite 100",
      line2: "",
      city: "Demo City",
      state: "CA",
      postal_code: "90000",
      country: "US",
    },
  });

  // --- Client 1: full journey through a simulated certified mailing and a response -----------
  const avery = await createClient(ctx, {
    full_name: "Avery Example (fictional)",
    email: "avery.example@example.com",
    phone: "555-0101",
    ...fictionalAddress("100 Sample Street, Apt 4B"),
    preferred_contact: "email",
    notes: "FICTIONAL DEMO CLIENT. Not a real person.",
    tags: ["demo", "billing"],
  });
  const averyCase = await createCase(ctx, avery.id, {
    title: "Billing question — Example Utility Co. (fictional)",
    category: "billing",
    description: "Fictional scenario: the client believes a monthly statement shows an unexpected charge.",
    organization: "Example Utility Co. (fictional)",
    account_last4: "0000",
    status: "waiting",
    next_action: "Review the response letter",
  });
  const averyDoc = await uploadDocument(ctx, {
    client_id: avery.id,
    case_id: averyCase.id,
    category: "supporting_evidence",
    description: "Fictional statement excerpt",
    filename: "fictional-statement.pdf",
    bytes: await renderFictionalSamplePdf("Fictional statement excerpt", [
      "Example Utility Co. (fictional)",
      "Statement period: sample only",
      "This document exists only to demonstrate attachments.",
    ]),
    demo_fictional_ack: true,
  });
  const averyLetter = await createLetter(ctx, {
    client_id: avery.id,
    case_id: averyCase.id,
    title: "Question about statement charge",
    template_id: "starter-general",
    recipient_name: "Example Utility Co. (fictional)",
    recipient_address: {
      line1: "200 Placeholder Road",
      line2: "Attn: Customer Correspondence",
      city: "Demo City",
      state: "CA",
      postal_code: "90000",
      country: "US",
    },
    mail_options: { service: "certified", return_receipt: true },
  });
  // Fill the neutral template's placeholders with fictional text.
  await updateLetter(ctx, averyLetter.id, {
    title: averyLetter.title,
    letter_type: averyLetter.letter_type,
    sender_address: averyLetter.sender_address,
    recipient_name: averyLetter.recipient_name,
    recipient_address: averyLetter.recipient_address,
    mail_options: averyLetter.mail_options,
    expects_response: true,
    body: averyLetter.body
      .replace("[[DESCRIBE THE MATTER IN YOUR OWN WORDS]]", "a charge on my most recent statement (fictional demo text)")
      .replace("[[STATE THE FACTS YOU WANT TO COMMUNICATE]]", "This paragraph is placeholder text for the demo.")
      .replace("[[STATE WHAT YOU ARE ASKING THE RECIPIENT TO DO]]", "Please explain the charge in writing.")
      .replace("[[LIST ENCLOSURES, OR DELETE THIS LINE]]", "Fictional statement excerpt"),
  });
  await setAttachments(ctx, averyLetter.id, [averyDoc.id]);
  const averyPacket = await preparePacket(ctx, averyLetter.id);
  await approvePacket(ctx, averyPacket.id, { packetHash: averyPacket.packet_hash, reviewedPacket: true });
  const sent = await submitMailing(ctx, {
    packetId: averyPacket.id,
    packetHash: averyPacket.packet_hash,
    confirmFinal: true,
    acknowledgeCharges: false,
  });
  for (const ev of ["processing", "mailed", "in_transit", "delivered"] as const) {
    await recordSimulatedEvent(ctx, sent.mailing.id, ev);
  }
  await recordResponse(ctx, {
    client_id: avery.id,
    case_id: averyCase.id,
    mailing_id: sent.mailing.id,
    received_date: today,
    sender_name: "Example Utility Co. (fictional)",
    notes: "Fictional response received for the demo. Needs review.",
    next_action: "Review response and decide next step",
    follow_up_date: addDays(today, 3),
    file: {
      filename: "fictional-response.pdf",
      bytes: await renderFictionalSamplePdf("Fictional response letter", [
        "From: Example Utility Co. (fictional)",
        "This response is invented demo content.",
      ]),
    },
    demo_fictional_ack: true,
  });

  // --- Client 2: packet waiting for approval, follow-up due today ------------------------------
  const jordan = await createClient(ctx, {
    full_name: "Jordan Sample (fictional)",
    email: "jordan.sample@example.com",
    phone: "555-0102",
    ...fictionalAddress("300 Demo Lane"),
    preferred_contact: "phone",
    notes: "FICTIONAL DEMO CLIENT. Not a real person.",
    tags: ["demo", "information-request"],
  });
  const jordanCase = await createCase(ctx, jordan.id, {
    title: "Account information request — Sample Finance LLC (fictional)",
    category: "information_request",
    description: "Fictional scenario: the client wants copies of account records.",
    organization: "Sample Finance LLC (fictional)",
    account_last4: "1111",
    status: "open",
    next_action: "Approve the packet",
    reminder_date: today,
  });
  const jordanLetter = await createLetter(ctx, {
    client_id: jordan.id,
    case_id: jordanCase.id,
    title: "Request for account records",
    recipient_name: "Sample Finance LLC (fictional)",
    recipient_address: {
      line1: "400 Example Boulevard",
      line2: "Floor 2",
      city: "Demo City",
      state: "CA",
      postal_code: "90000",
      country: "US",
    },
    body:
      "Re: Account ending in 1111 (fictional)\n\nTo whom it may concern:\n\nThis is fictional demo text requesting copies of account records.\n\nSincerely,\n\n\nJordan Sample (fictional)",
    mail_options: { service: "first_class", return_receipt: false },
  });
  await preparePacket(ctx, jordanLetter.id);
  await createFollowUp(ctx, {
    client_id: jordan.id,
    case_id: jordanCase.id,
    kind: "review_case",
    title: "Review packet before sending",
    due_date: today,
    notes: "Fictional reminder.",
  });

  // --- Client 3: closed case plus an unfinished draft -----------------------------------------
  const riley = await createClient(ctx, {
    full_name: "Riley Placeholder (fictional)",
    email: "riley.placeholder@example.com",
    phone: "555-0103",
    ...fictionalAddress("500 Mock Court"),
    preferred_contact: "mail",
    notes: "FICTIONAL DEMO CLIENT. Not a real person.",
    tags: ["demo"],
  });
  await createCase(ctx, riley.id, {
    title: "Resolved matter — Placeholder Services Inc. (fictional)",
    category: "general",
    description: "Fictional closed scenario.",
    organization: "Placeholder Services Inc. (fictional)",
    status: "closed",
    outcome: "Fictional outcome recorded by the owner for demo purposes.",
  });
  const rileyOpen = await createCase(ctx, riley.id, {
    title: "New correspondence — Placeholder Services Inc. (fictional)",
    category: "general",
    organization: "Placeholder Services Inc. (fictional)",
    status: "open",
    next_action: "Finish the draft letter",
  });
  await createLetter(ctx, {
    client_id: riley.id,
    case_id: rileyOpen.id,
    title: "Draft: follow-up letter",
    template_id: "starter-follow-up",
    recipient_name: "Placeholder Services Inc. (fictional)",
    recipient_address: { line1: "600 Sample Way", city: "Demo City", state: "CA", postal_code: "90000", country: "US" },
  });
  await createFollowUp(ctx, {
    client_id: riley.id,
    case_id: rileyOpen.id,
    kind: "prepare_next_correspondence",
    title: "Finish follow-up draft",
    due_date: addDays(today, -1),
  });
}
