/**
 * Publishing: articles, books and e-books, written section by section.
 *
 *   createPublication()   staff start one; the Publishing agents can outline it
 *   writeSectionWithAI()  the Staff Writer (articles) or the Book & E-book Author writes a part
 *   submitPublication()   compliance check + executive approval before anything goes outside
 *   exportModel()         what the PDF and EPUB exports contain; marked DRAFT unless the exact
 *                         approved text is unchanged
 *
 * Everything here is internal until approved. Editing an approved publication sends it back to
 * drafting, and the approved text is kept as a hash so any change shows.
 */
import { z } from "zod";
import {
  ApprovalType,
  ContentChannel,
  NotificationKind,
  PublicationKind,
  PublicationStatus,
} from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { runSkill } from "@/server/agents/runner";
import { publishingChapterSkill, publishingOutlineSkill } from "@/server/agents/skills";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { evaluateContent } from "@/server/compliance/engine";
import { loadActiveRules, runComplianceCheck } from "@/server/compliance/service";
import { notifyUser } from "@/server/notifications";
import { contentHash } from "./hash";

export { contentHash };

export const KIND_LABEL: Record<PublicationKind, string> = {
  ARTICLE: "Article",
  EBOOK: "E-book",
  BOOK: "Book",
};

export const partWord = (kind: PublicationKind) => (kind === "ARTICLE" ? "section" : "chapter");

export class PublicationStateError extends Error {
  readonly status = 409;
}

const EDITABLE: PublicationStatus[] = [
  PublicationStatus.DRAFTING,
  PublicationStatus.REJECTED,
  PublicationStatus.APPROVED,
];

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

async function loadPublication(client: DbClient, actor: Actor, id: string) {
  authorize(actor, "publishing.manage");
  const publication = await client.publication.findUnique({
    where: { id },
    include: {
      author: { select: { name: true } },
      sections: { orderBy: { position: "asc" } },
    },
  });
  if (!publication) throw new ForbiddenError("That publication does not exist.");
  return publication;
}

/** Any edit: allowed while drafting, after a rejection, or after approval (which it undoes). */
async function startEditing(
  client: DbClient,
  publication: { id: string; status: PublicationStatus },
) {
  if (!EDITABLE.includes(publication.status)) {
    throw new PublicationStateError("It is waiting for approval. Edit it after the decision.");
  }
  if (publication.status !== PublicationStatus.DRAFTING) {
    await client.publication.update({
      where: { id: publication.id },
      data: { status: PublicationStatus.DRAFTING },
    });
  }
}

export async function listPublications(actor: Actor, client: Db = db) {
  authorize(actor, "publishing.manage");
  const items = await client.publication.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      author: { select: { name: true } },
      sections: { select: { body: true } },
    },
  });
  return items.map((p) => ({
    ...p,
    sectionCount: p.sections.length,
    words: p.sections.reduce((n, s) => n + wordCount(s.body), 0),
    written: p.sections.filter((s) => s.body.trim().length > 0).length,
  }));
}

export async function getPublication(actor: Actor, id: string, client: Db = db) {
  const p = await loadPublication(client, actor, id);
  const hash = contentHash(p);
  return {
    publication: p,
    words: p.sections.reduce((n, s) => n + wordCount(s.body), 0),
    /** Approved, and the text is exactly what was approved. */
    approvedAndUnchanged: p.status === PublicationStatus.APPROVED && p.approvedHash === hash,
    changedSinceApproval: Boolean(p.approvedHash) && p.approvedHash !== hash,
  };
}

// ------------------------------------------------------------------ create --

export const createSchema = z.object({
  title: z.string().trim().min(3, "Give it a title.").max(160),
  subtitle: z.string().trim().max(200).optional(),
  kind: z.nativeEnum(PublicationKind),
  audience: z.string().trim().min(3, "Say who it is for.").max(120),
  description: z.string().trim().min(10, "Describe it in a sentence or two.").max(2000),
  outlineWithAI: z.boolean().default(false),
  sectionCount: z.coerce.number().int().min(1).max(30).default(6),
});

async function publishingAgent(client: DbClient, kind: PublicationKind) {
  const slug = kind === PublicationKind.ARTICLE ? "staff-writer" : "book-author";
  const agent = await client.agent.findUnique({ where: { slug } });
  if (!agent) throw new ForbiddenError("The Publishing agents are not set up.");
  return agent;
}

export async function createPublication(
  actor: Actor,
  input: z.input<typeof createSchema>,
  client: Db = db,
) {
  authorize(actor, "publishing.manage");
  const data = createSchema.parse(input);
  let outline: { title: string; summary: string }[] = [];
  if (data.outlineWithAI) {
    const agent = await publishingAgent(client, data.kind);
    const result = await runSkill(
      publishingOutlineSkill,
      agent,
      {
        title: data.title,
        kind: data.kind,
        audience: data.audience,
        description: data.description,
        sectionCount: data.sectionCount,
      },
      { purpose: "publishing outline", client },
    );
    outline = result.output.sections;
  }
  return client.$transaction(async (tx) => {
    const publication = await tx.publication.create({
      data: {
        title: data.title,
        subtitle: data.subtitle || null,
        kind: data.kind,
        audience: data.audience,
        description: data.description,
        authorId: actor.id,
        sections: {
          create: outline.map((s, i) => ({ position: i + 1, title: s.title, summary: s.summary })),
        },
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "publication.created",
      entityType: "Publication",
      entityId: publication.id,
      after: { kind: data.kind, sections: outline.length, outlinedByAI: data.outlineWithAI },
    });
    return publication;
  });
}

// ------------------------------------------------------------------- edit --

export const sectionSchema = z.object({
  title: z.string().trim().min(2, "Give it a title.").max(160),
  summary: z.string().trim().max(400).default(""),
  body: z.string().max(60000).default(""),
});

export async function addSection(
  actor: Actor,
  publicationId: string,
  title: string,
  client: Db = db,
) {
  const p = await loadPublication(client, actor, publicationId);
  await startEditing(client, p);
  const clean = z.string().trim().min(2, "Give it a title.").max(160).parse(title);
  return client.publicationSection.create({
    data: {
      publicationId,
      position: (p.sections.at(-1)?.position ?? 0) + 1,
      title: clean,
    },
  });
}

async function loadSection(client: DbClient, actor: Actor, sectionId: string) {
  const section = await client.publicationSection.findUnique({ where: { id: sectionId } });
  if (!section) throw new ForbiddenError("That part does not exist.");
  const publication = await loadPublication(client, actor, section.publicationId);
  return { section, publication };
}

export async function updateSection(
  actor: Actor,
  sectionId: string,
  input: z.input<typeof sectionSchema>,
  client: Db = db,
) {
  const { publication } = await loadSection(client, actor, sectionId);
  await startEditing(client, publication);
  const data = sectionSchema.parse(input);
  return client.publicationSection.update({
    where: { id: sectionId },
    data: { ...data, writtenBy: "person" },
  });
}

export async function moveSection(
  actor: Actor,
  sectionId: string,
  direction: "up" | "down",
  client: Db = db,
) {
  const { section, publication } = await loadSection(client, actor, sectionId);
  await startEditing(client, publication);
  const list = publication.sections;
  const index = list.findIndex((s) => s.id === sectionId);
  const swapWith = list[direction === "up" ? index - 1 : index + 1];
  if (!swapWith) return;
  await client.$transaction([
    client.publicationSection.update({
      where: { id: section.id },
      data: { position: swapWith.position },
    }),
    client.publicationSection.update({
      where: { id: swapWith.id },
      data: { position: section.position },
    }),
  ]);
}

export async function deleteSection(actor: Actor, sectionId: string, client: Db = db) {
  const { publication } = await loadSection(client, actor, sectionId);
  await startEditing(client, publication);
  await client.publicationSection.delete({ where: { id: sectionId } });
  return publication.id;
}

/** The Publishing agent writes (or rewrites) one part. Replaces its text. */
export async function writeSectionWithAI(
  actor: Actor,
  sectionId: string,
  note?: string,
  client: Db = db,
) {
  const { section, publication } = await loadSection(client, actor, sectionId);
  await startEditing(client, publication);
  const agent = await publishingAgent(client, publication.kind);
  const result = await runSkill(
    publishingChapterSkill,
    agent,
    {
      publicationTitle: publication.title,
      kind: publication.kind,
      audience: publication.audience,
      sectionTitle: section.title,
      sectionSummary: section.summary || section.title,
      otherTitles: publication.sections.filter((s) => s.id !== section.id).map((s) => s.title),
      note: note?.trim().slice(0, 500) || undefined,
    },
    { purpose: "publishing chapter", client },
  );
  return client.publicationSection.update({
    where: { id: sectionId },
    data: { body: result.output.body, writtenBy: `${agent.title} (${agent.name})` },
  });
}

// --------------------------------------------------------------- approval --

export function publicationPayload(p: {
  id: string;
  title: string;
  kind: PublicationKind;
  subtitle: string | null;
  sections: { title: string; body: string }[];
}) {
  return {
    kind: "publication",
    publicationId: p.id,
    title: p.title,
    format: p.kind,
    parts: p.sections.length,
    words: p.sections.reduce((n, s) => n + wordCount(s.body), 0),
    contentHash: contentHash(p),
  };
}

export function isPublicationPayload(
  p: unknown,
): p is { kind: "publication"; publicationId: string; contentHash: string } {
  return typeof p === "object" && p !== null && (p as { kind?: unknown }).kind === "publication";
}

export async function submitPublication(
  actor: Actor & { name?: string | null },
  id: string,
  client: Db = db,
) {
  const p = await loadPublication(client, actor, id);
  const submittable: PublicationStatus[] = [PublicationStatus.DRAFTING, PublicationStatus.REJECTED];
  if (!submittable.includes(p.status)) {
    throw new PublicationStateError(
      p.status === PublicationStatus.IN_REVIEW
        ? "It is already waiting for approval."
        : "It is approved. Edit it first to send a new version.",
    );
  }
  if (p.sections.length === 0) throw new PublicationStateError("Add at least one part first.");
  const empty = p.sections.filter((s) => wordCount(s.body) < 20);
  if (empty.length) {
    throw new PublicationStateError(
      `Write every ${partWord(p.kind)} first. Still empty: ${empty.map((s) => s.title).join(", ")}.`,
    );
  }
  const text = [p.title, p.subtitle ?? "", ...p.sections.flatMap((s) => [s.title, s.body])].join(
    "\n\n",
  );
  // Owned channel (like email): rules that apply only to social posts do not apply here.
  const compliance = evaluateContent(text, ContentChannel.EMAIL, await loadActiveRules(client));
  const payload = publicationPayload(p);
  const { submitApproval } = await import("@/server/approvals/service");

  return client.$transaction(async (tx) => {
    const claimed = await tx.publication.updateMany({
      where: { id, status: { in: submittable } },
      data: { status: PublicationStatus.IN_REVIEW },
    });
    if (claimed.count !== 1) throw new PublicationStateError("It changed. Reload and try again.");
    const request = await submitApproval(tx, {
      type: ApprovalType.PUBLICATION,
      title: `Publish: ${p.title}`,
      summary: `${KIND_LABEL[p.kind]} for ${p.audience}: ${p.sections.length} ${partWord(p.kind)}${p.sections.length === 1 ? "" : "s"}, about ${payload.words.toLocaleString("en-US")} words.`,
      payload,
      reasoning: `${actor.name ?? "A team member"} sent "${p.title}" for approval to publish outside the company. Read the full text in the Publishing workspace before deciding. Approval covers exactly this version; any later edit needs a new approval.`,
      sources: [
        {
          title: `Manuscript: ${p.title}`,
          url: `/content/publishing/${p.id}`,
          note: p.description.slice(0, 200),
        },
      ],
      risk: compliance.risk,
      requestedByUserId: actor.id,
    });
    await runComplianceCheck(tx, {
      text,
      channel: ContentChannel.EMAIL,
      approvalRequestId: request.id,
    });
    await tx.publication.update({ where: { id }, data: { approvalRequestId: request.id } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "publication.submitted",
      entityType: "Publication",
      entityId: id,
      after: {
        approvalRequestId: request.id,
        contentHash: payload.contentHash,
        risk: compliance.risk,
      },
    });
    return request;
  });
}

/** Called inside decideApproval's transaction. */
export async function applyPublicationDecision(
  tx: DbClient,
  request: { id: string; payload: unknown },
  decision: "APPROVE" | "REJECT",
  note: string | null,
) {
  if (!isPublicationPayload(request.payload)) return;
  const p = await tx.publication.findUnique({ where: { id: request.payload.publicationId } });
  if (!p || p.approvalRequestId !== request.id) return;
  await tx.publication.update({
    where: { id: p.id },
    data:
      decision === "APPROVE"
        ? {
            status: PublicationStatus.APPROVED,
            approvedHash: request.payload.contentHash,
            approvedAt: new Date(),
          }
        : { status: PublicationStatus.REJECTED },
  });
  await notifyUser(tx, p.authorId, {
    kind: NotificationKind.APPROVAL_DECIDED,
    title: `${decision === "APPROVE" ? "Approved to publish" : "Not approved"}: ${p.title}`,
    body:
      decision === "APPROVE"
        ? "Approved. The PDF and EPUB exports are now final."
        : (note ?? "Not approved."),
    href: `/content/publishing/${p.id}`,
  });
}

// ------------------------------------------------------------------ export --

export async function exportModel(actor: Actor, id: string, client: Db = db) {
  const { publication: p, approvedAndUnchanged, words } = await getPublication(actor, id, client);
  return {
    title: p.title,
    subtitle: p.subtitle,
    kind: p.kind,
    audience: p.audience,
    author: "AACTIVATED RX",
    final: approvedAndUnchanged,
    words,
    updatedAt: p.updatedAt,
    sections: p.sections.map((s) => ({ id: s.id, title: s.title, body: s.body })),
  };
}
export type ExportModel = Awaited<ReturnType<typeof exportModel>>;
