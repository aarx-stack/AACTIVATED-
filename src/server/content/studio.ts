/**
 * Content Studio: humans and agents share one calendar.
 *  - Reps only ever see and touch their own content; executives and staff see everything.
 *  - Human-written drafts go through the same compliance check and Approval Queue,
 *    and the author cannot approve their own post.
 *  - Scheduling hands an APPROVED post to GoHighLevel only through the outbound gate.
 */
import { z } from "zod";
import {
  ApprovalStatus,
  ContentChannel,
  ContentStatus,
  RepAgentRole,
  Role,
} from "@/generated/prisma/enums";
import type { ModelAdapter } from "@/lib/ai/types";
import { db, type Db, type DbClient } from "@/lib/db";
import { runSkill } from "@/server/agents/runner";
import { CHANNEL_LABEL, rewriteSkill } from "@/server/agents/skills";
import { isSocialPostPayload } from "@/server/approvals/payload";
import { assertDispatchable, DispatchBlockedError } from "@/server/approvals/service";
import { recordAudit } from "@/server/audit/audit";
import { authorize, type Actor, ForbiddenError } from "@/server/authz/permissions";
import { getGoHighLevel } from "@/server/integrations";
import { getPodAgent } from "@/server/reps/pods";
import { checkAndSubmitContent } from "./review";

const SOCIAL = [
  ContentChannel.FACEBOOK,
  ContentChannel.INSTAGRAM,
  ContentChannel.TIKTOK,
  ContentChannel.YOUTUBE,
] as const;

export function isCompanyRole(role: Role) {
  return role === Role.EXECUTIVE || role === Role.STAFF;
}

/** Reps: own content only. Executives and staff: everything. */
export function canAccessContent(
  actor: Pick<Actor, "id" | "role">,
  item: { repId: string | null },
) {
  if (isCompanyRole(actor.role)) return true;
  return actor.role === Role.PREMIUM_REP && item.repId === actor.id;
}

async function loadAccessible(client: DbClient, actor: Actor, id: string) {
  const item = await client.contentItem.findUnique({ where: { id } });
  if (!item || !canAccessContent(actor, item))
    throw new ForbiddenError("You cannot access that post.");
  return item;
}

export const draftSchema = z.object({
  title: z.string().trim().min(3, "Add a short title.").max(120),
  caption: z.string().trim().min(10, "The caption is too short.").max(2200),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .regex(/^#[\p{L}\p{N}_]+$/u, "Hashtags start with # and have no spaces."),
    )
    .max(10)
    .default([]),
  channel: z.enum(SOCIAL),
  plannedFor: z.coerce.date().optional(),
});

function hashtagsFrom(body: string) {
  return [...new Set(body.match(/#[\p{L}\p{N}_]+/gu) ?? [])];
}

export async function createDraft(
  actor: Actor,
  input: z.input<typeof draftSchema>,
  client: Db = db,
) {
  authorize(actor, "content.create");
  const data = draftSchema.parse(input);
  return client.$transaction(async (tx) => {
    const item = await tx.contentItem.create({
      data: {
        title: data.title,
        body: data.hashtags.length ? `${data.caption}\n\n${data.hashtags.join(" ")}` : data.caption,
        channel: data.channel,
        status: ContentStatus.DRAFT,
        scheduledFor: data.plannedFor ?? null,
        repId: actor.role === Role.PREMIUM_REP ? actor.id : null,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "content.created",
      entityType: "ContentItem",
      entityId: item.id,
      after: { title: item.title, channel: item.channel },
    });
    return item;
  });
}

const EDITABLE: ContentStatus[] = [ContentStatus.DRAFT, ContentStatus.REJECTED];

export async function updateDraft(
  actor: Actor,
  id: string,
  input: z.input<typeof draftSchema>,
  client: Db = db,
) {
  authorize(actor, "content.create");
  const data = draftSchema.parse(input);
  return client.$transaction(async (tx) => {
    const item = await loadAccessible(tx, actor, id);
    if (!EDITABLE.includes(item.status)) {
      throw new ForbiddenError(
        "Only drafts can be edited here. Items in review are edited in the Approval Queue.",
      );
    }
    const updated = await tx.contentItem.update({
      where: { id },
      data: {
        title: data.title,
        body: data.hashtags.length ? `${data.caption}\n\n${data.hashtags.join(" ")}` : data.caption,
        channel: data.channel,
        scheduledFor: data.plannedFor ?? item.scheduledFor,
        status: ContentStatus.DRAFT,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "content.edited",
      entityType: "ContentItem",
      entityId: id,
      before: { title: item.title, body: item.body, status: item.status },
      after: { title: updated.title, body: updated.body, status: updated.status },
    });
    return updated;
  });
}

/** Splits a stored body back into caption + trailing hashtags. */
export function splitBody(body: string) {
  const lines = body.trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (/^(#[\p{L}\p{N}_]+\s*)+$/u.test(last.trim())) {
    return { caption: lines.slice(0, -1).join("\n").trimEnd(), hashtags: hashtagsFrom(last) };
  }
  return { caption: body, hashtags: [] as string[] };
}

export const submitSchema = z.object({ why: z.string().trim().max(600).optional() });

/** A human sends their own draft for review. They can never approve it themselves. */
export async function submitDraft(
  actor: Actor & { name?: string | null },
  id: string,
  input: z.input<typeof submitSchema> = {},
  client: Db = db,
) {
  authorize(actor, "content.create");
  const { why } = submitSchema.parse(input);
  return client.$transaction(async (tx) => {
    const item = await loadAccessible(tx, actor, id);
    if (!EDITABLE.includes(item.status))
      throw new ForbiddenError("This post is already in review or approved.");
    const { caption, hashtags } = splitBody(item.body);
    const author = actor.name ?? "A team member";
    return checkAndSubmitContent(tx, {
      contentItemId: item.id,
      payload: { channel: item.channel, title: item.title, caption, hashtags },
      summary: `${CHANNEL_LABEL[item.channel]} post written by ${author} in the Content Studio.`,
      reasoning:
        why && why.length >= 10
          ? why
          : `Written by ${author} in the Content Studio and submitted for review.`,
      sources: [{ title: "Content Studio draft", note: `Author: ${author}` }],
      requestedByUserId: actor.id,
    });
  });
}

/** AI caption suggestions from the writer agent. Nothing is saved until the person chooses. */
export async function rewriteCaption(
  actor: Actor,
  id: string,
  instruction: string | undefined,
  options: { client?: Db; adapter?: ModelAdapter } = {},
) {
  authorize(actor, "content.create");
  const client = options.client ?? db;
  const item = await loadAccessible(client, actor, id);
  const writer =
    actor.role === Role.PREMIUM_REP
      ? await getPodAgent(client, actor.id, RepAgentRole.CONTENT_CREATOR)
      : await client.agent.findUnique({
          where: { slug: "content-specialist" },
          select: {
            id: true,
            name: true,
            title: true,
            status: true,
            config: true,
            departmentId: true,
          },
        });
  if (!writer) throw new ForbiddenError("No writer agent is available.");
  const { caption } = splitBody(item.body);
  const result = await runSkill(
    rewriteSkill,
    writer,
    {
      title: item.title,
      caption,
      channel: item.channel,
      instruction: instruction?.trim() || undefined,
    },
    { purpose: "Content Studio: caption suggestions", client, adapter: options.adapter },
  );
  return result.output.variants;
}

// --------------------------------------------------------------- schedule --

export const scheduleSchema = z.object({ at: z.coerce.date() });
const MIN_LEAD_MS = 5 * 60_000;
const MAX_AHEAD_MS = 90 * 86_400_000;

export async function scheduleContent(
  actor: Actor,
  id: string,
  input: z.input<typeof scheduleSchema>,
  client: Db = db,
  now = new Date(),
) {
  authorize(actor, "content.schedule");
  const { at } = scheduleSchema.parse(input);
  if (at.getTime() < now.getTime() + MIN_LEAD_MS)
    throw new ForbiddenError("Pick a time at least 5 minutes from now.");
  if (at.getTime() > now.getTime() + MAX_AHEAD_MS)
    throw new ForbiddenError("Pick a time within the next 90 days.");

  const item = await loadAccessible(client, actor, id);
  if (item.status !== ContentStatus.APPROVED)
    throw new DispatchBlockedError("Only approved posts can be scheduled.");
  const approval = await client.approvalRequest.findFirst({
    where: { contentItemId: id, status: ApprovalStatus.APPROVED },
    orderBy: { decidedAt: "desc" },
  });
  if (!approval) throw new DispatchBlockedError("No approval found for this post.");
  if (approval.dispatchedAt)
    throw new DispatchBlockedError("This post was already handed to the scheduler.");
  // The gate: approved, and exactly the payload that was approved.
  await assertDispatchable(client, approval.id, approval.payload);
  if (!isSocialPostPayload(approval.payload))
    throw new DispatchBlockedError("This approval is not a social post.");

  const subAccountId = item.repId
    ? (await client.repProfile.findUnique({ where: { userId: item.repId } }))?.ghlSubAccountId
    : "company";
  if (!subAccountId)
    throw new DispatchBlockedError("The rep's GoHighLevel sub-account is not set up.");

  // Claim before handing it to the scheduler, so it can never be scheduled twice. Released if
  // the scheduler call fails.
  const claimed = await client.approvalRequest.updateMany({
    where: { id: approval.id, dispatchedAt: null },
    data: { dispatchedAt: new Date() },
  });
  if (claimed.count !== 1)
    throw new DispatchBlockedError("This post was already handed to the scheduler.");

  let posted: { externalId: string };
  try {
    posted = await getGoHighLevel().schedulePost({
      subAccountId,
      channel: approval.payload.channel,
      caption: approval.payload.caption,
      hashtags: approval.payload.hashtags,
      scheduledFor: at,
    });
  } catch (error) {
    // Graceful degradation: the post stays approved and can be scheduled once the integration is back.
    await client.approvalRequest.update({
      where: { id: approval.id },
      data: { dispatchedAt: null },
    });
    await recordAudit(client, {
      actor: { type: "USER", userId: actor.id },
      action: "content.schedule_failed",
      entityType: "ContentItem",
      entityId: id,
      correlationId: approval.correlationId,
      metadata: { reason: error instanceof Error ? error.message : "Unknown error" },
    });
    throw error;
  }

  return client.$transaction(async (tx) => {
    const updated = await tx.contentItem.update({
      where: { id },
      data: {
        status: ContentStatus.SCHEDULED,
        scheduledFor: at,
        externalPostId: posted.externalId,
        scheduledById: actor.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "content.scheduled",
      entityType: "ContentItem",
      entityId: id,
      correlationId: approval.correlationId,
      before: { status: item.status },
      after: {
        status: updated.status,
        scheduledFor: at,
        externalPostId: posted.externalId,
        payloadHash: approval.payloadHash,
      },
    });
    return updated;
  });
}
