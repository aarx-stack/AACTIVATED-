/**
 * Email campaigns, sent through GoHighLevel after approval.
 *
 *   saveCampaign()        staff (company audiences) or a Premium rep (their own contacts) write a
 *                         draft; draftWithAI() has an agent write one from a brief
 *   submitCampaign()      compliance check + Approval Queue. Someone other than the author decides;
 *                         high-risk or large sends need an executive
 *   applyCampaignDecision() called by decideApproval
 *   sendCampaign()        only an approved, unchanged campaign is sent. Exactly once per person;
 *                         unsubscribed, do-not-disturb and address-less contacts are skipped
 *   unsubscribe()         the link in every email; honored before every later send
 *
 * Company audiences are GoHighLevel contacts with a tag (clinic, member, rep). A rep's campaign
 * goes only to their own consented contacts who have not opted out.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  ApprovalType,
  CampaignStatus,
  ContactStatus,
  ContentChannel,
  EmailAudience,
  EmailSendStatus,
  NotificationKind,
  RepAgentRole,
  Role,
} from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { recordAudit } from "@/server/audit/audit";
import { runSkill } from "@/server/agents/runner";
import { emailDraftSkill } from "@/server/agents/skills";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { evaluateContent } from "@/server/compliance/engine";
import { loadActiveRules, runComplianceCheck } from "@/server/compliance/service";
import { getGoHighLevel, type GoHighLevelAdapter } from "@/server/integrations";
import { notifyUser } from "@/server/notifications";
import { getPodAgent } from "@/server/reps/pods";

export const AUDIENCE_LABEL: Record<EmailAudience, string> = {
  CLINICS: "Clinics",
  MEMBERS: "Members",
  REPS: "Reps",
  MY_CONTACTS: "My contacts",
};

/** GoHighLevel tag for each company audience. */
export const AUDIENCE_TAG: Partial<Record<EmailAudience, string>> = {
  CLINICS: "clinic",
  MEMBERS: "member",
  REPS: "rep",
};

/** Sends to more people than this need an executive's approval. */
export const LARGE_SEND = 250;
const MAX_PAGES = 50;

export class CampaignStateError extends Error {
  readonly status = 409;
}

const isCompanyRole = (role: Role) => role === Role.EXECUTIVE || role === Role.STAFF;

export function audiencesFor(role: Role): EmailAudience[] {
  if (isCompanyRole(role))
    return [EmailAudience.CLINICS, EmailAudience.MEMBERS, EmailAudience.REPS];
  if (role === Role.PREMIUM_REP) return [EmailAudience.MY_CONTACTS];
  return [];
}

/** Exactly what is approved, and therefore exactly what may be sent. */
export function campaignPayload(c: {
  id: string;
  audience: EmailAudience;
  subject: string;
  body: string;
  recipientEstimate?: number | null;
}) {
  return {
    kind: "email_campaign",
    campaignId: c.id,
    audience: c.audience,
    channel: "EMAIL",
    to: `${AUDIENCE_LABEL[c.audience]}${c.recipientEstimate != null ? ` (about ${c.recipientEstimate})` : ""}`,
    subject: c.subject,
    message: c.body,
  };
}

export function isCampaignPayload(p: unknown): p is { kind: "email_campaign"; campaignId: string } {
  return typeof p === "object" && p !== null && (p as { kind?: unknown }).kind === "email_campaign";
}

async function loadAccessible(client: DbClient, actor: Actor, id: string) {
  authorize(actor, "email.campaigns");
  const campaign = await client.emailCampaign.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } } },
  });
  if (!campaign) throw new ForbiddenError("That campaign is not available to you.");
  const own = campaign.repId === actor.id;
  if (!isCompanyRole(actor.role) && !own) {
    throw new ForbiddenError("That campaign is not available to you.");
  }
  return campaign;
}

export async function listCampaigns(actor: Actor, client: Db = db) {
  authorize(actor, "email.campaigns");
  return client.emailCampaign.findMany({
    where: isCompanyRole(actor.role) ? {} : { repId: actor.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { createdBy: { select: { name: true } } },
  });
}

export async function getCampaign(actor: Actor, id: string, client: Db = db) {
  const campaign = await loadAccessible(client, actor, id);
  const sends = await client.emailSend.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return { campaign, sends };
}

// --------------------------------------------------------------- drafting --

export const campaignSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(3, "Give the campaign a name.").max(120),
  audience: z.nativeEnum(EmailAudience),
  subject: z.string().trim().min(5, "Write a subject line.").max(120),
  body: z.string().trim().min(40, "Write the email (at least a few sentences).").max(8000),
});

export async function saveCampaign(
  actor: Actor,
  input: z.input<typeof campaignSchema>,
  client: Db = db,
) {
  authorize(actor, "email.campaigns");
  const data = campaignSchema.parse(input);
  if (!audiencesFor(actor.role).includes(data.audience)) {
    throw new ForbiddenError("You cannot email that audience.");
  }
  const fields = {
    name: data.name,
    audience: data.audience,
    subject: data.subject,
    body: data.body,
  };
  if (!data.id) {
    return client.emailCampaign.create({
      data: {
        ...fields,
        createdById: actor.id,
        repId: data.audience === EmailAudience.MY_CONTACTS ? actor.id : null,
      },
    });
  }
  const existing = await loadAccessible(client, actor, data.id);
  const editable: CampaignStatus[] = [CampaignStatus.DRAFT, CampaignStatus.REJECTED];
  if (!editable.includes(existing.status)) {
    throw new CampaignStateError("Only drafts and rejected campaigns can be edited.");
  }
  return client.emailCampaign.update({
    where: { id: existing.id },
    data: { ...fields, status: CampaignStatus.DRAFT, approvalRequestId: null, lastError: null },
  });
}

/** An agent writes a draft from a brief. The person edits it before anything is submitted. */
export async function draftWithAI(
  actor: Actor & { name?: string | null },
  input: { brief: string; audience: EmailAudience },
  client: Db = db,
) {
  authorize(actor, "email.campaigns");
  const brief = z
    .string()
    .trim()
    .min(10, "Describe the email in a sentence.")
    .max(1000)
    .parse(input.brief);
  if (!audiencesFor(actor.role).includes(input.audience)) {
    throw new ForbiddenError("You cannot email that audience.");
  }
  const agent =
    input.audience === EmailAudience.MY_CONTACTS
      ? await getPodAgent(client, actor.id, RepAgentRole.CONTENT_CREATOR)
      : await client.agent.findUnique({ where: { slug: "content-specialist" } });
  if (!agent) throw new ForbiddenError("No content agent is available to draft this.");
  const result = await runSkill(
    emailDraftSkill,
    agent,
    {
      brief,
      audienceLabel: AUDIENCE_LABEL[input.audience].toLowerCase(),
      senderName: actor.name ?? "The AACTIVATED team",
    },
    { purpose: "email draft", client },
  );
  return result.output;
}

// ----------------------------------------------------------------- audience --

export interface Recipient {
  key: string;
  name: string | null;
  email: string | null;
  /** Why this person will not be emailed, if so. */
  skip?: string;
}

export const emailHash = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** Everyone the campaign could go to, each marked with a skip reason where one applies. */
export async function resolveRecipients(
  client: DbClient,
  campaign: { audience: EmailAudience; repId: string | null },
  ghl: GoHighLevelAdapter = getGoHighLevel(),
): Promise<Recipient[]> {
  let people: Recipient[] = [];
  if (campaign.audience === EmailAudience.MY_CONTACTS) {
    const contacts = await client.contact.findMany({
      where: { repId: campaign.repId ?? "" },
      orderBy: { createdAt: "asc" },
    });
    people = contacts.map((c) => ({
      key: c.id,
      name: c.name,
      email: c.email,
      skip:
        c.status === ContactStatus.OPTED_OUT
          ? "Opted out"
          : ghl.mode === "live" && !c.ghlContactId
            ? "Not linked to GoHighLevel"
            : undefined,
    }));
  } else {
    const tag = AUDIENCE_TAG[campaign.audience]!;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { contacts, hasMore } = await ghl.listContacts({ tag, page, pageSize: 100 });
      people.push(
        ...contacts.map((c) => ({
          key: c.id,
          name: c.name,
          email: c.email,
          skip: c.emailDnd ? "Do not disturb in GoHighLevel" : undefined,
        })),
      );
      if (!hasMore) break;
    }
  }
  const suppressed = new Set(
    (
      await client.emailSuppression.findMany({
        where: {
          emailHash: { in: people.filter((p) => p.email).map((p) => emailHash(p.email!)) },
        },
        select: { emailHash: true },
      })
    ).map((s) => s.emailHash),
  );
  return people.map((p) => ({
    ...p,
    skip:
      p.skip ??
      (!p.email
        ? "No email address"
        : suppressed.has(emailHash(p.email))
          ? "Unsubscribed"
          : undefined),
  }));
}

// ------------------------------------------------------------------ approval --

export async function submitCampaign(actor: Actor, id: string, client: Db = db) {
  const campaign = await loadAccessible(client, actor, id);
  if (campaign.status !== CampaignStatus.DRAFT) {
    throw new CampaignStateError("Only a draft can be sent for approval.");
  }
  const recipients = await resolveRecipients(client, campaign);
  const estimate = recipients.filter((r) => !r.skip).length;
  if (estimate === 0) throw new CampaignStateError("Nobody in this audience can be emailed.");

  const text = `${campaign.subject}\n\n${campaign.body}`;
  const compliance = evaluateContent(text, ContentChannel.EMAIL, await loadActiveRules(client));
  const { submitApproval } = await import("@/server/approvals/service");

  return client.$transaction(async (tx) => {
    const claimed = await tx.emailCampaign.updateMany({
      where: { id, status: CampaignStatus.DRAFT },
      data: { status: CampaignStatus.IN_REVIEW, recipientEstimate: estimate },
    });
    if (claimed.count !== 1)
      throw new CampaignStateError("This campaign changed. Reload and try again.");
    const request = await submitApproval(tx, {
      type: ApprovalType.EMAIL,
      title: `Email: ${campaign.name}`,
      summary: `"${campaign.subject}" to ${AUDIENCE_LABEL[campaign.audience].toLowerCase()} (about ${estimate} people).`,
      payload: campaignPayload({ ...campaign, recipientEstimate: estimate }),
      reasoning: `${campaign.createdBy.name ?? "A team member"} wrote this email for ${AUDIENCE_LABEL[campaign.audience].toLowerCase()}. It goes only to contacts who agreed to receive email, through GoHighLevel, with an unsubscribe link.`,
      sources: [
        {
          title: `Audience: ${AUDIENCE_LABEL[campaign.audience]}`,
          note: `${estimate} can be emailed; ${recipients.length - estimate} skipped (unsubscribed, do-not-disturb or no address).`,
        },
      ],
      risk: compliance.risk,
      requestedByUserId: actor.id,
      minimumRole: estimate > LARGE_SEND ? Role.EXECUTIVE : null,
    });
    await runComplianceCheck(tx, {
      text,
      channel: ContentChannel.EMAIL,
      approvalRequestId: request.id,
    });
    await tx.emailCampaign.update({ where: { id }, data: { approvalRequestId: request.id } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "email.campaign_submitted",
      entityType: "EmailCampaign",
      entityId: id,
      after: { approvalRequestId: request.id, recipientEstimate: estimate, risk: compliance.risk },
    });
    return request;
  });
}

/** Called inside decideApproval's transaction. */
export async function applyCampaignDecision(
  tx: DbClient,
  request: { id: string; payload: unknown },
  decision: "APPROVE" | "REJECT",
  note: string | null,
) {
  if (!isCampaignPayload(request.payload)) return;
  const campaign = await tx.emailCampaign.findUnique({
    where: { id: request.payload.campaignId },
  });
  if (!campaign || campaign.approvalRequestId !== request.id) return;
  await tx.emailCampaign.update({
    where: { id: campaign.id },
    data: { status: decision === "APPROVE" ? CampaignStatus.APPROVED : CampaignStatus.REJECTED },
  });
  await notifyUser(tx, campaign.createdById, {
    kind: NotificationKind.APPROVAL_DECIDED,
    title: `${decision === "APPROVE" ? "Approved" : "Rejected"}: ${campaign.name}`,
    body: decision === "APPROVE" ? "Approved. You can send it now." : (note ?? "Rejected."),
    href: `/content/email/${campaign.id}`,
  });
}

// --------------------------------------------------------------- unsubscribe --

function signingKey() {
  const env = getEnv();
  return env.AUTH_SECRET || `dev-only:${env.DATABASE_URL}`;
}

/** Signed so nobody can unsubscribe someone else by guessing. Holds no secrets. */
export function unsubscribeToken(input: { key: string; email: string; campaignId: string }) {
  const body = Buffer.from(
    JSON.stringify({ k: input.key, e: input.email, c: input.campaignId }),
  ).toString("base64url");
  const sig = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readUnsubscribeToken(token: string) {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      k?: string;
      e?: string;
      c?: string;
    };
    return p.k && p.e && p.c ? { key: p.k, email: p.e, campaignId: p.c } : null;
  } catch {
    return null;
  }
}

/** Honors an unsubscribe link. Idempotent; never reveals anything about the person. */
export async function unsubscribe(token: string, client: Db = db) {
  const data = readUnsubscribeToken(token);
  if (!data) return { ok: false as const };
  const hash = emailHash(data.email);
  const campaign = await client.emailCampaign.findUnique({
    where: { id: data.campaignId },
    select: { id: true, repId: true, audience: true },
  });
  await client.emailSuppression.upsert({
    where: { emailHash: hash },
    create: { emailHash: hash, campaignId: campaign?.id ?? null },
    update: {},
  });
  if (campaign?.audience === EmailAudience.MY_CONTACTS) {
    await client.contact.updateMany({
      where: { id: data.key, repId: campaign.repId ?? "" },
      data: { status: ContactStatus.OPTED_OUT },
    });
  } else {
    // Also mark it in GoHighLevel, best effort: the suppression above already stops our sends.
    await getGoHighLevel()
      .setEmailDoNotDisturb({ subAccountId: "company", contactId: data.key })
      .catch(() => undefined);
  }
  await recordAudit(client, {
    actor: { type: "SYSTEM" },
    action: "email.unsubscribed",
    entityType: "EmailCampaign",
    entityId: campaign?.id ?? null,
    // The address itself is never written to the log.
    metadata: { emailHash: hash.slice(0, 16) },
  });
  return { ok: true as const };
}

// --------------------------------------------------------------------- send --

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email exactly as sent: the approved body plus the unsubscribe footer. */
export function renderEmail(body: string, unsubscribeUrl: string) {
  const footer = "You are receiving this because you agreed to receive email from AACTIVATED RX.";
  const text = `${body}\n\n--\n${footer}\nUnsubscribe: ${unsubscribeUrl}`;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `${paragraphs}<hr><p style="font-size:12px;color:#666">${escapeHtml(footer)} <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`;
  return { text, html };
}

export async function sendCampaign(
  actor: Actor,
  id: string,
  client: Db = db,
  ghl: GoHighLevelAdapter = getGoHighLevel(),
) {
  const campaign = await loadAccessible(client, actor, id);
  if (campaign.status !== CampaignStatus.APPROVED || !campaign.approvalRequestId) {
    throw new CampaignStateError("Only an approved campaign can be sent.");
  }
  const { assertDispatchable } = await import("@/server/approvals/service");
  await assertDispatchable(client, campaign.approvalRequestId, campaignPayload(campaign));

  let subAccountId = "company";
  if (campaign.audience === EmailAudience.MY_CONTACTS) {
    const profile = await client.repProfile.findUnique({ where: { userId: campaign.repId ?? "" } });
    if (!profile?.ghlSubAccountId) {
      throw new CampaignStateError(
        "The rep's GoHighLevel sub-account is not set up. Nothing was sent.",
      );
    }
    subAccountId = profile.ghlSubAccountId;
  }

  // Claim it, so two clicks can never send it twice.
  const claimed = await client.emailCampaign.updateMany({
    where: { id, status: CampaignStatus.APPROVED },
    data: { status: CampaignStatus.SENDING, lastError: null },
  });
  if (claimed.count !== 1) throw new CampaignStateError("This campaign is already being sent.");

  let recipients: Recipient[];
  try {
    recipients = await resolveRecipients(client, campaign, ghl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The audience could not be read.";
    await client.emailCampaign.update({
      where: { id },
      data: { status: CampaignStatus.APPROVED, lastError: message },
    });
    throw error;
  }

  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of recipients) {
    const already = await client.emailSend.findUnique({
      where: { campaignId_recipientKey: { campaignId: id, recipientKey: r.key } },
    });
    if (already) continue;
    if (r.skip) {
      await client.emailSend.create({
        data: {
          campaignId: id,
          recipientKey: r.key,
          name: r.name,
          email: r.email,
          status: EmailSendStatus.SKIPPED,
          reason: r.skip,
        },
      });
      skipped++;
      continue;
    }
    const contactId =
      campaign.audience === EmailAudience.MY_CONTACTS
        ? ((
            await client.contact.findUnique({
              where: { id: r.key },
              select: { ghlContactId: true },
            })
          )?.ghlContactId ?? r.key)
        : r.key;
    const url = `${appUrl}/unsubscribe?t=${unsubscribeToken({ key: r.key, email: r.email!, campaignId: id })}`;
    const { text, html } = renderEmail(campaign.body, url);
    try {
      const result = await ghl.sendMessage({
        subAccountId,
        contactId,
        channel: "EMAIL",
        subject: campaign.subject,
        message: text,
        html,
      });
      await client.emailSend.create({
        data: {
          campaignId: id,
          recipientKey: r.key,
          name: r.name,
          email: r.email,
          status: EmailSendStatus.SENT,
          externalId: result.externalId,
        },
      });
      sent++;
    } catch (error) {
      await client.emailSend.create({
        data: {
          campaignId: id,
          recipientKey: r.key,
          name: r.name,
          email: r.email,
          status: EmailSendStatus.FAILED,
          reason: error instanceof Error ? error.message.slice(0, 200) : "Failed.",
        },
      });
      failed++;
    }
    // Stay well inside GoHighLevel's rate limits.
    if (ghl.mode === "live") await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const done = await client.$transaction(async (tx) => {
    const updated = await tx.emailCampaign.update({
      where: { id },
      data: {
        status: CampaignStatus.SENT,
        sentAt: new Date(),
        sentCount: { increment: sent },
        skippedCount: { increment: skipped },
        failedCount: { increment: failed },
      },
    });
    await tx.approvalRequest.update({
      where: { id: campaign.approvalRequestId! },
      data: { dispatchedAt: new Date() },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "email.campaign_sent",
      entityType: "EmailCampaign",
      entityId: id,
      after: { sent, skipped, failed, audience: campaign.audience },
    });
    return updated;
  });
  return { campaign: done, sent, skipped, failed };
}
