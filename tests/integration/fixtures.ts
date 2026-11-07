import type { AgentStatus } from "@/generated/prisma/enums";
import { db } from "./helpers";

const AGENTS = [
  {
    slug: "brain",
    name: "The Brain",
    title: "AI CEO",
    kind: "BRAIN" as const,
    dept: null,
    tools: ["tasks.create", "handoff.create", "approval.request"],
  },
  {
    slug: "ops-manager",
    name: "Atlas",
    title: "Operations Manager",
    kind: "DEPARTMENT" as const,
    dept: "operations",
    tools: ["tasks.create", "handoff.create"],
  },
  {
    slug: "content-specialist",
    name: "Quill",
    title: "Content Specialist",
    kind: "DEPARTMENT" as const,
    dept: "marketing",
    tools: ["content.draft", "compliance.check", "approval.request"],
  },
];

/** Idempotent: the integration database is shared across test files in one run. */
export async function ensureWorkflowFixtures() {
  const owner = await db.user.upsert({
    where: { email: "fixture-owner@example.test" },
    create: {
      email: "fixture-owner@example.test",
      name: "Fixture Owner",
      role: "EXECUTIVE",
      status: "ACTIVE",
    },
    update: {},
  });
  const depts: Record<string, string> = {};
  for (const [slug, name] of [
    ["operations", "Operations"],
    ["marketing", "Marketing"],
  ] as const) {
    const d = await db.department.upsert({
      where: { slug },
      create: { slug, name, description: name },
      update: {},
    });
    depts[slug] = d.id;
  }
  for (const a of AGENTS) {
    await db.agent.upsert({
      where: { slug: a.slug },
      create: {
        slug: a.slug,
        name: a.name,
        title: a.title,
        kind: a.kind,
        status: "ACTIVE",
        ownerId: owner.id,
        departmentId: a.dept ? depts[a.dept] : null,
        config: {
          role: a.title,
          context: "Test context.",
          dailyRoutine: "Test routine.",
          toolsAllowed: a.tools,
        },
      },
      update: { status: "ACTIVE" },
    });
  }
  if ((await db.complianceRule.count()) === 0) {
    await db.complianceRule.createMany({
      data: [
        {
          type: "MEDICAL_CLAIM",
          pattern: "\\b(cures?|treats?|heals?)\\b",
          isRegex: true,
          severity: "CRITICAL",
          description: "Medical or health claim.",
          suggestion: "Describe education, not outcomes.",
        },
        {
          type: "PEPTIDE_NAME",
          pattern: "BPC-157",
          channels: ["INSTAGRAM", "TIKTOK", "FACEBOOK", "YOUTUBE"],
          severity: "HIGH",
          description: "Specific peptide name on social.",
        },
        {
          type: "BLOCKLIST_TERM",
          pattern: "miracle",
          severity: "MEDIUM",
          description: "Algorithm-trigger word.",
        },
      ],
    });
  }
}

export async function setAgentStatus(slug: string, status: AgentStatus) {
  await db.agent.update({ where: { slug }, data: { status } });
}

const REP_TEMPLATES = [
  {
    key: "rep.content_creator",
    name: "Content Creator",
    role: "CONTENT_CREATOR",
    tools: ["content.draft", "compliance.check", "approval.request"],
  },
  {
    key: "rep.social_manager",
    name: "Social Media Manager",
    role: "SOCIAL_MEDIA_MANAGER",
    tools: ["content.plan", "ghl.social.schedule"],
  },
  {
    key: "rep.lead_followup",
    name: "Lead Follow-up Specialist",
    role: "LEAD_FOLLOWUP",
    tools: ["ghl.contacts.read", "approval.request"],
  },
  {
    key: "rep.business_coach",
    name: "Business Coach",
    role: "BUSINESS_COACH",
    tools: ["report.write"],
  },
] as const;

/** Rep agent templates with one version each (idempotent). */
export async function ensureRepFixtures() {
  await ensureWorkflowFixtures();
  for (const t of REP_TEMPLATES) {
    const template = await db.agentTemplate.upsert({
      where: { key: t.key },
      create: { key: t.key, name: t.name, repRole: t.role, currentVersion: 1 },
      update: {},
    });
    await db.agentTemplateVersion.upsert({
      where: { templateId_version: { templateId: template.id, version: 1 } },
      create: {
        templateId: template.id,
        version: 1,
        role: `${t.name} v1 role.`,
        context: "v1 context.",
        dailyRoutine: "v1 routine.",
        toolsAllowed: [...t.tools],
      },
      update: {},
    });
  }
}
