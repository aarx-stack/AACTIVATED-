/**
 * Knowledge Library. Access is enforced in the database query: a document the actor may not
 * read is never loaded, so it cannot leak through search, counts, summaries or the detail page.
 *
 *   listDocuments()      search + category, readable documents only, with per-category counts
 *   getDocument()        one readable document (null otherwise, so existence is not revealed)
 *   summarizeDocument()  the Brain writes the AI summary panel (summary + key takeaways)
 *   createDocument()     staff add documents; confidential ones are executive-only
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccessLevel, AgentKind, DocumentCategory, Role } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { AgentUnavailableError, runSkill } from "@/server/agents/runner";
import { knowledgeSummarySkill } from "@/server/agents/skills";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { readableAccessLevels } from "@/server/authz/policies";

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  POLICIES: "Policies",
  TRAINING: "Training",
  LEGAL_RESEARCH: "Legal Research",
  BRAND: "Brand",
  PRODUCT_EDUCATION: "Product Education",
};

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  EXECUTIVE_ONLY: "Executive Only",
  ALL_STAFF: "All Staff",
  ALL_USERS: "Everyone",
};

/** Categories that hold company-confidential material: executive-only, always. */
export const CONFIDENTIAL_CATEGORIES: readonly DocumentCategory[] = [
  DocumentCategory.LEGAL_RESEARCH,
];

export const SORTS = ["relevant", "recent", "title"] as const;
export type DocumentSort = (typeof SORTS)[number];

function readableWhere(role: Role): Prisma.DocumentWhereInput {
  return { accessLevel: { in: readableAccessLevels(role) } };
}

function searchWhere(q: string | undefined): Prisma.DocumentWhereInput {
  const term = q?.trim();
  if (!term) return {};
  return {
    OR: [
      { title: { contains: term, mode: "insensitive" } },
      { summary: { contains: term, mode: "insensitive" } },
      { body: { contains: term, mode: "insensitive" } },
      { tags: { has: term.toLowerCase() } },
    ],
  };
}

export async function listDocuments(
  actor: Actor,
  filters: { q?: string; category?: DocumentCategory | null; sort?: DocumentSort },
  client: Db = db,
) {
  authorize(actor, "knowledge.view");
  const base: Prisma.DocumentWhereInput = {
    AND: [readableWhere(actor.role), searchWhere(filters.q)],
  };
  const where: Prisma.DocumentWhereInput = filters.category
    ? { AND: [base, { category: filters.category }] }
    : base;

  const orderBy: Prisma.DocumentOrderByWithRelationInput[] =
    filters.sort === "title"
      ? [{ title: "asc" }]
      : filters.sort === "recent"
        ? [{ updatedAt: "desc" }]
        : [{ category: "asc" }, { updatedAt: "desc" }];

  const [documents, counts, total] = await Promise.all([
    client.document.findMany({
      where,
      orderBy,
      select: {
        id: true,
        title: true,
        category: true,
        accessLevel: true,
        summary: true,
        tags: true,
        updatedAt: true,
        body: true,
        summarizedAt: true,
      },
    }),
    client.document.groupBy({ by: ["category"], where: base, _count: { _all: true } }),
    client.document.count({ where: base }),
  ]);

  // Relevance: title matches first, then summary, then body.
  const term = filters.q?.trim().toLowerCase();
  const ranked =
    term && (filters.sort ?? "relevant") === "relevant"
      ? [...documents].sort((a, b) => score(b, term) - score(a, term))
      : documents;

  return {
    documents: ranked.map(({ body, ...d }) => ({ ...d, words: wordCount(body) })),
    counts: Object.fromEntries(counts.map((c) => [c.category, c._count._all])) as Partial<
      Record<DocumentCategory, number>
    >,
    total,
  };
}

function score(d: { title: string; summary: string | null; body: string }, term: string) {
  return (
    (d.title.toLowerCase().includes(term) ? 4 : 0) +
    (d.summary?.toLowerCase().includes(term) ? 2 : 0) +
    (d.body.toLowerCase().includes(term) ? 1 : 0)
  );
}

export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Null when it does not exist or the actor may not read it. */
export async function getDocument(actor: Actor, id: string, client: Db = db) {
  authorize(actor, "knowledge.view");
  return client.document.findFirst({
    where: { AND: [{ id }, readableWhere(actor.role)] },
    include: { owner: { select: { name: true } } },
  });
}

export async function summarizeDocument(actor: Actor, id: string, client: Db = db) {
  authorize(actor, "knowledge.manage");
  const doc = await getDocument(actor, id, client);
  if (!doc) throw new ForbiddenError("That document is not available to you.");
  const brain = await client.agent.findFirst({
    where: { kind: AgentKind.BRAIN },
    select: { id: true, name: true, title: true, status: true, config: true, departmentId: true },
  });
  if (!brain) throw new AgentUnavailableError("The Brain is not configured.");

  const { output } = await runSkill(
    knowledgeSummarySkill,
    brain,
    { title: doc.title, body: doc.body },
    { purpose: `Knowledge summary: ${doc.title}`, client },
  );
  return client.$transaction(async (tx) => {
    const updated = await tx.document.update({
      where: { id: doc.id },
      data: { summary: output.summary, keyPoints: output.keyPoints, summarizedAt: new Date() },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "document.summarized",
      entityType: "Document",
      entityId: doc.id,
      metadata: { agentId: brain.id },
    });
    return updated;
  });
}

export const documentSchema = z.object({
  title: z.string().trim().min(3, "Give the document a title.").max(140),
  category: z.enum(DocumentCategory),
  accessLevel: z.enum(AccessLevel),
  body: z.string().trim().min(40, "Add the document text (at least a few sentences).").max(100_000),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8),
    ),
});

export async function createDocument(
  actor: Actor,
  input: z.input<typeof documentSchema>,
  client: Db = db,
) {
  authorize(actor, "knowledge.manage");
  const data = documentSchema.parse(input);
  const confidential = CONFIDENTIAL_CATEGORIES.includes(data.category);
  // Legal research is always executive-only, whatever was picked.
  const accessLevel = confidential ? AccessLevel.EXECUTIVE_ONLY : data.accessLevel;
  if (accessLevel === AccessLevel.EXECUTIVE_ONLY && actor.role !== Role.EXECUTIVE) {
    throw new ForbiddenError("Only executives can add executive-only or legal documents.");
  }
  const doc = await client.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        title: data.title,
        category: data.category,
        accessLevel,
        body: data.body,
        tags: data.tags,
        ownerId: actor.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "document.created",
      entityType: "Document",
      entityId: created.id,
      after: { title: created.title, category: created.category, accessLevel },
    });
    return created;
  });
  return doc;
}
