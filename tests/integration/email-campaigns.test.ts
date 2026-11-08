import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { decideApproval, DispatchBlockedError } from "@/server/approvals/service";
import { ForbiddenError } from "@/server/authz/permissions";
import {
  draftWithAI,
  getCampaign,
  listCampaigns,
  readUnsubscribeToken,
  saveCampaign,
  sendCampaign,
  submitCampaign,
  unsubscribe,
  unsubscribeToken,
} from "@/server/email/campaigns";
import { buildAdapters, type GhlContact, resetAdapters } from "@/server/integrations";
import { MOCK_CONTACTS } from "@/server/integrations/mock";
import { completeOnboarding } from "@/server/reps/onboarding";
import { addContact } from "@/server/reps/service";
import { ensureRepFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(async () => {
  await ensureRepFixtures();
  // Earlier runs (or other tests) must not leave anyone unsubscribed.
  await db.emailSuppression.deleteMany({});
});
afterEach(() => resetAdapters());
afterAll(() => db.$disconnect());

const BODY =
  "Hello,\n\nOur December education webinar for clinic teams is on December 10.\n\nReply to save a seat.";

/** The mock GoHighLevel, with every sent email recorded. */
function recordingAdapters(contacts?: Record<string, GhlContact[]>) {
  const base = buildAdapters();
  const sent: { contactId: string; subject?: string; html?: string; message: string }[] = [];
  resetAdapters({
    ...base,
    GOHIGHLEVEL: {
      ...base.GOHIGHLEVEL,
      listContacts: contacts
        ? async ({ tag, page = 1, pageSize = 100 }) => {
            const all = contacts[tag] ?? [];
            const start = (page - 1) * pageSize;
            return {
              contacts: all.slice(start, start + pageSize),
              hasMore: start + pageSize < all.length,
            };
          }
        : base.GOHIGHLEVEL.listContacts,
      sendMessage: async (input) => {
        sent.push(input);
        return { externalId: `test-${sent.length}` };
      },
    },
  });
  return sent;
}

async function approvedClinicCampaign(author: { id: string; role: Role }, name = "Webinar") {
  const campaign = await saveCampaign(author, {
    name,
    audience: "CLINICS",
    subject: "Your invitation: December webinar",
    body: BODY,
  });
  const request = await submitCampaign(author, campaign.id);
  const reviewer = await createUser(Role.STAFF);
  await decideApproval(reviewer, request.id, { decision: "APPROVE" });
  return { campaign, request };
}

describe("email campaigns", () => {
  it("draft, approval by someone else, send once, skip people without an address", async () => {
    const sent = recordingAdapters();
    const maya = await createUser(Role.STAFF);
    const campaign = await saveCampaign(maya, {
      name: "Clinic webinar",
      audience: "CLINICS",
      subject: "Your invitation: December webinar",
      body: BODY,
    });
    expect(campaign.status).toBe("DRAFT");

    const request = await submitCampaign(maya, campaign.id);
    expect(request.type).toBe("EMAIL");
    expect(request.requiredRole).toBe("STAFF");
    const emailable = MOCK_CONTACTS.clinic!.filter((c) => c.email && !c.emailDnd).length;
    expect((await getCampaign(maya, campaign.id)).campaign.recipientEstimate).toBe(emailable);

    // The author cannot approve it; another staff member can.
    await expect(decideApproval(maya, request.id, { decision: "APPROVE" })).rejects.toThrow(
      /own request/,
    );
    await expect(sendCampaign(maya, campaign.id)).rejects.toThrow(/approved/);
    const devon = await createUser(Role.STAFF);
    await decideApproval(devon, request.id, { decision: "APPROVE" });
    expect((await getCampaign(maya, campaign.id)).campaign.status).toBe("APPROVED");
    expect(
      await db.notification.count({
        where: { userId: maya.id, title: "Approved: Clinic webinar" },
      }),
    ).toBe(1);

    const result = await sendCampaign(maya, campaign.id);
    expect(result).toMatchObject({
      sent: emailable,
      skipped: MOCK_CONTACTS.clinic!.length - emailable,
      failed: 0,
    });
    expect(sent).toHaveLength(emailable);
    expect(sent[0]!.subject).toBe("Your invitation: December webinar");
    expect(sent[0]!.message).toContain("Unsubscribe: ");
    expect(sent[0]!.html).toContain("/unsubscribe?t=");

    const after = await getCampaign(maya, campaign.id);
    expect(after.campaign.status).toBe("SENT");
    expect(after.sends.find((s) => s.status === "SKIPPED")?.reason).toBe("No email address");
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).dispatchedAt,
    ).not.toBeNull();
    await expect(sendCampaign(maya, campaign.id)).rejects.toThrow(/approved/);
    expect(sent).toHaveLength(emailable);
  });

  it("refuses to send content that changed after it was approved", async () => {
    recordingAdapters();
    const maya = await createUser(Role.STAFF);
    const { campaign } = await approvedClinicCampaign(maya);
    await db.emailCampaign.update({
      where: { id: campaign.id },
      data: { body: `${BODY}\n\nAlso: this cures everything.` },
    });
    await expect(sendCampaign(maya, campaign.id)).rejects.toBeInstanceOf(DispatchBlockedError);
    expect(await db.emailSend.count({ where: { campaignId: campaign.id } })).toBe(0);
  });

  it("an unsubscribe is honored on every later send", async () => {
    recordingAdapters();
    const maya = await createUser(Role.STAFF);
    const { campaign } = await approvedClinicCampaign(maya, "First");
    await sendCampaign(maya, campaign.id);
    const first = MOCK_CONTACTS.clinic!.find((c) => c.email)!;

    const token = unsubscribeToken({ key: first.id, email: first.email!, campaignId: campaign.id });
    expect(readUnsubscribeToken(`${token}x`)).toBeNull();
    expect((await unsubscribe("forged.token")).ok).toBe(false);
    expect((await unsubscribe(token)).ok).toBe(true);
    expect((await unsubscribe(token)).ok).toBe(true); // idempotent

    const sent = recordingAdapters();
    const { campaign: second } = await approvedClinicCampaign(maya, "Second");
    await sendCampaign(maya, second.id);
    expect(sent.some((s) => s.contactId === first.id)).toBe(false);
    const skipped = await db.emailSend.findFirstOrThrow({
      where: { campaignId: second.id, recipientKey: first.id },
    });
    expect(skipped.reason).toBe("Unsubscribed");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "email.unsubscribed" } });
    expect(JSON.stringify(audit)).not.toContain(first.email!);
    await db.emailSuppression.deleteMany({});
  });

  it("large sends and compliance failures need an executive", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `big-${i}`,
      name: `Member ${i}`,
      email: `m${i}@example.test`,
      emailDnd: false,
    }));
    recordingAdapters({ member: many, clinic: MOCK_CONTACTS.clinic! });
    const staff = await createUser(Role.STAFF);
    const big = await saveCampaign(staff, {
      name: "Everyone",
      audience: "MEMBERS",
      subject: "A note for every member",
      body: BODY,
    });
    expect((await submitCampaign(staff, big.id)).requiredRole).toBe("EXECUTIVE");

    const risky = await saveCampaign(staff, {
      name: "Risky",
      audience: "CLINICS",
      subject: "This routine cures soreness",
      body: BODY,
    });
    const request = await submitCampaign(staff, risky.id);
    expect(request.requiredRole).toBe("EXECUTIVE");
    const check = await db.complianceCheck.findFirstOrThrow({
      where: { approvalRequestId: request.id },
    });
    expect(check.outcome).toBe("FAIL");
  });

  it("reps email only their own consented contacts; staff cannot pick a rep's contacts", async () => {
    const sent = recordingAdapters();
    const rep = await createUser(Role.PREMIUM_REP);
    await completeOnboarding(rep, { acceptContentRules: true, acceptLeadPolicy: true });
    const consent = {
      preferredChannel: "EMAIL" as const,
      consentSource: "WEB_FORM" as const,
      consentAt: new Date(Date.now() - 86_400_000),
      consentEvidence: "Requested the guide on the website",
    };
    const yes = await addContact(rep, { ...consent, name: "Avery", email: "avery@example.test" });
    const out = await addContact(rep, { ...consent, name: "Blake", email: "blake@example.test" });
    await db.contact.update({ where: { id: out.id }, data: { status: "OPTED_OUT" } });

    await expect(
      saveCampaign(rep, {
        name: "Nope",
        audience: "CLINICS",
        subject: "Hello clinics",
        body: BODY,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const staff = await createUser(Role.STAFF);
    await expect(
      saveCampaign(staff, { name: "Nope", audience: "MY_CONTACTS", subject: "Hello", body: BODY }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const free = await createUser(Role.FREE_REP);
    await expect(listCampaigns(free)).rejects.toBeInstanceOf(ForbiddenError);

    const campaign = await saveCampaign(rep, {
      name: "Thanks",
      audience: "MY_CONTACTS",
      subject: "Thanks for joining",
      body: BODY,
    });
    const otherRep = await createUser(Role.PREMIUM_REP);
    await expect(getCampaign(otherRep, campaign.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listCampaigns(staff)).some((c) => c.id === campaign.id)).toBe(true);

    const request = await submitCampaign(rep, campaign.id);
    await decideApproval(staff, request.id, { decision: "APPROVE" });
    const result = await sendCampaign(rep, campaign.id);
    expect(result.sent).toBe(1);
    expect(sent.map((s) => s.contactId)).toEqual([yes.id]);
    const skipped = await db.emailSend.findFirstOrThrow({
      where: { campaignId: campaign.id, recipientKey: out.id },
    });
    expect(skipped.reason).toBe("Opted out");
  });

  it("an agent drafts the email; the person still saves and submits it", async () => {
    const staff = await createUser(Role.STAFF);
    const draft = await draftWithAI(
      { ...staff, name: "Maya" },
      { brief: "Invite clinics to the December webinar.", audience: "CLINICS" },
    );
    expect(draft.subject.length).toBeGreaterThan(4);
    expect(draft.body).toContain("Maya");
    expect(await db.emailCampaign.count({ where: { createdById: staff.id } })).toBe(0);
  });
});
