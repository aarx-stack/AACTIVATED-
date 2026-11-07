/**
 * Demo seed for AACTIVATED AI Brain.
 *
 * - Deterministic (seeded PRNG) so screenshots and tests are stable.
 * - All people except Guy Griffithe and Isaac Muniz are fictional demo users on
 *   the reserved `.test` domain, so no real email can ever be sent.
 * - Compliance terms are PLACEHOLDERS for executives to replace.
 * - Refuses to run twice: AuditLog is append-only, so reset with `npm run db:reset`.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type {
  ActivityKind,
  AgentStatus,
  ApprovalType,
  ContentChannel,
  ContentStatus,
  RepAgentRole,
  RiskLevel,
  TaskPriority,
  TaskStatus,
} from "../src/generated/prisma/enums";
import { requiredRoleFor } from "../src/server/approvals/policy";
import { createHash } from "node:crypto";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ---------------------------------------------------------------- helpers --
let seed = 20261107;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const between = (min: number, max: number) => min + rand() * (max - min);

const NOW = new Date();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);
const monthStart = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
const monthEnd = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0, 23, 59, 59);
const usd = (n: number, dp = 2) => new Prisma.Decimal(n.toFixed(dp));
const hashPayload = (payload: unknown) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

function agentConfig(role: string, context: string, dailyRoutine: string, toolsAllowed: string[]) {
  return { role, context, dailyRoutine, toolsAllowed };
}

// ------------------------------------------------------------------ data --
const USERS = [
  {
    key: "guy",
    name: "Guy Griffithe",
    email: "guy@aactivated.test",
    role: "EXECUTIVE",
    title: "Founder & CEO (final approver)",
  },
  {
    key: "isaac",
    name: "Isaac Muniz",
    email: "isaac@aactivated.test",
    role: "SYSTEM_ADMIN",
    title: "System Administrator",
  },
  {
    key: "maya",
    name: "Maya Torres",
    email: "maya@aactivated.test",
    role: "STAFF",
    title: "Operations Lead (demo)",
  },
  {
    key: "devon",
    name: "Devon Brooks",
    email: "devon@aactivated.test",
    role: "STAFF",
    title: "Marketing Lead (demo)",
  },
  {
    key: "rosa",
    name: "Rosa Kim",
    email: "rosa@aactivated.test",
    role: "STAFF",
    title: "Social & Media Lead (demo)",
  },
  {
    key: "nate",
    name: "Nate Alvarez",
    email: "nate@aactivated.test",
    role: "STAFF",
    title: "Affiliate Success Lead (demo)",
  },
  {
    key: "alicia",
    name: "Alicia Grant",
    email: "alicia@aactivated.test",
    role: "STAFF",
    title: "Support Lead (demo)",
  },
  {
    key: "jordan",
    name: "Jordan Ellis",
    email: "jordan@aactivated.test",
    role: "PREMIUM_REP",
    title: "Premium Rep · Presenter (demo)",
  },
  {
    key: "priya",
    name: "Priya Shah",
    email: "priya@aactivated.test",
    role: "PREMIUM_REP",
    title: "Premium Rep (demo)",
  },
  {
    key: "sam",
    name: "Sam Carter",
    email: "sam@aactivated.test",
    role: "FREE_REP",
    title: "Free Rep (demo)",
  },
] as const;
type UserKey = (typeof USERS)[number]["key"];

const DEPARTMENTS = [
  {
    slug: "operations",
    name: "Operations",
    owner: "maya",
    confidential: false,
    description: "Runs the daily plan, routes work between departments and keeps SLAs.",
  },
  {
    slug: "sales",
    name: "Sales & Affiliate Success",
    owner: "nate",
    confidential: false,
    description: "Onboards and supports reps and affiliates. Consented inbound leads only.",
  },
  {
    slug: "marketing",
    name: "Marketing",
    owner: "devon",
    confidential: false,
    description: "Campaigns, brand messaging and compliant educational content.",
  },
  {
    slug: "social",
    name: "Social Media",
    owner: "rosa",
    confidential: false,
    description: "Plans and drafts posts per platform rules. Nothing posts without approval.",
  },
  {
    slug: "media",
    name: "Media",
    owner: "rosa",
    confidential: false,
    description: "Video, graphics and the asset library.",
  },
  {
    slug: "finance",
    name: "Finance",
    owner: "guy",
    confidential: true,
    description: "Budgets, spend tracking and reporting. Corporate accounting is executive-only.",
  },
  {
    slug: "legal",
    name: "Legal & Compliance",
    owner: "guy",
    confidential: true,
    description: "Content rules, regulatory research and policy. Executive-only records.",
  },
  {
    slug: "support",
    name: "Support",
    owner: "alicia",
    confidential: false,
    description: "Answers member and rep questions from the knowledge library.",
  },
  {
    slug: "technology",
    name: "Technology",
    owner: "isaac",
    confidential: false,
    description: "Integrations, uptime and security of the portal.",
  },
  {
    slug: "development",
    name: "Development",
    owner: "isaac",
    confidential: false,
    description: "Builds new products and platform features from the roadmap.",
  },
  {
    slug: "hr",
    name: "Human Resources",
    owner: "guy",
    confidential: true,
    description: "People operations and HR records. Executive-only.",
  },
] as const;
type DeptSlug = (typeof DEPARTMENTS)[number]["slug"];

const COMPANY_AGENTS: {
  slug: string;
  name: string;
  title: string;
  dept: DeptSlug;
  owner: UserKey;
  status: AgentStatus;
  focus: string;
  tools: string[];
}[] = [
  {
    slug: "ops-manager",
    name: "Atlas",
    title: "Operations Manager",
    dept: "operations",
    owner: "maya",
    status: "ACTIVE",
    focus: "Coordinating the November content sprint across Marketing and Social Media.",
    tools: ["tasks.create", "handoff.create", "report.write"],
  },
  {
    slug: "affiliate-success",
    name: "Beacon",
    title: "Affiliate Success Manager",
    dept: "sales",
    owner: "nate",
    status: "ACTIVE",
    focus: "Preparing onboarding checklists for three new Premium reps.",
    tools: ["ghl.contacts.read", "tasks.create", "report.write"],
  },
  {
    slug: "content-specialist",
    name: "Quill",
    title: "Content Specialist",
    dept: "marketing",
    owner: "devon",
    status: "ACTIVE",
    focus: "Drafting the Recovery Stack education series (4 posts).",
    tools: ["content.draft", "compliance.check", "approval.request"],
  },
  {
    slug: "campaign-strategist",
    name: "Vector",
    title: "Campaign Strategist",
    dept: "marketing",
    owner: "devon",
    status: "IDLE",
    focus: "Waiting on Q1 campaign brief.",
    tools: ["content.plan", "report.write"],
  },
  {
    slug: "social-manager",
    name: "Echo",
    title: "Social Media Manager",
    dept: "social",
    owner: "rosa",
    status: "ACTIVE",
    focus: "Scheduling approved posts for next week across four platforms.",
    tools: ["content.draft", "compliance.check", "approval.request", "ghl.social.schedule"],
  },
  {
    slug: "media-producer",
    name: "Prism",
    title: "Media Producer",
    dept: "media",
    owner: "rosa",
    status: "IDLE",
    focus: "Idle. Next task: cut three 30-second reels.",
    tools: ["media.brief", "tasks.update"],
  },
  {
    slug: "finance-analyst",
    name: "Ledger",
    title: "Finance Analyst",
    dept: "finance",
    owner: "guy",
    status: "ACTIVE",
    focus: "Reconciling October QuickBooks export with AI spend events.",
    tools: ["quickbooks.read", "report.write"],
  },
  {
    slug: "compliance-officer",
    name: "Sentinel",
    title: "Compliance Officer",
    dept: "legal",
    owner: "guy",
    status: "ACTIVE",
    focus: "Reviewing updated platform rules for TikTok health content.",
    tools: ["compliance.rules.read", "report.write"],
  },
  {
    slug: "support-specialist",
    name: "Harbor",
    title: "Support Specialist",
    dept: "support",
    owner: "alicia",
    status: "ERROR",
    focus: "Help desk sync timed out. Waiting for retry.",
    tools: ["knowledge.search", "tasks.update"],
  },
  {
    slug: "systems-engineer",
    name: "Forge",
    title: "Systems Engineer",
    dept: "technology",
    owner: "isaac",
    status: "ACTIVE",
    focus: "Monitoring integration health and nightly backups.",
    tools: ["health.check", "report.write"],
  },
  {
    slug: "product-developer",
    name: "Blueprint",
    title: "Product Developer",
    dept: "development",
    owner: "isaac",
    status: "PAUSED",
    focus: "Paused pending executive review of the tokenization scope.",
    tools: ["tasks.update", "report.write"],
  },
  {
    slug: "people-ops",
    name: "Keystone",
    title: "People Operations",
    dept: "hr",
    owner: "guy",
    status: "IDLE",
    focus: "Quarterly contractor review prepared.",
    tools: ["report.write"],
  },
];

const REP_TEMPLATES: {
  key: string;
  name: string;
  repRole: RepAgentRole;
  versions: {
    role: string;
    context: string;
    dailyRoutine: string;
    tools: string[];
    note: string;
  }[];
}[] = [
  {
    key: "rep.content_creator",
    name: "Content Creator",
    repRole: "CONTENT_CREATOR",
    versions: [
      {
        role: "Draft educational posts for the rep's audience.",
        context:
          "Brand voice: calm, factual, encouraging. No medical claims. Use branded stack names only.",
        dailyRoutine: "Draft one post, run compliance check, submit for review.",
        tools: ["content.draft", "compliance.check"],
        note: "Initial version.",
      },
      {
        role: "Draft educational posts and short video scripts for the rep's audience.",
        context:
          "Brand voice: calm, factual, encouraging. No medical claims. Branded stack names only. Lead with a question hook; end with an invitation to learn more, never a sales push.",
        dailyRoutine:
          "Draft one post and one 30-second script, run compliance check, submit for review.",
        tools: ["content.draft", "compliance.check", "approval.request"],
        note: "Carry-forward: question hooks had 2x engagement in October.",
      },
    ],
  },
  {
    key: "rep.social_manager",
    name: "Social Media Manager",
    repRole: "SOCIAL_MEDIA_MANAGER",
    versions: [
      {
        role: "Plan the rep's weekly posting calendar.",
        context: "Follow each platform's rules. Never auto-follow, auto-comment or DM strangers.",
        dailyRoutine: "Fill gaps in the weekly calendar with approved content.",
        tools: ["content.plan", "ghl.social.schedule"],
        note: "Initial version.",
      },
    ],
  },
  {
    key: "rep.lead_followup",
    name: "Lead Follow-up Specialist",
    repRole: "LEAD_FOLLOWUP",
    versions: [
      {
        role: "Follow up with consented inbound contacts.",
        context:
          "Only contacts with recorded consent. No purchased lists, scraping or cold outreach.",
        dailyRoutine: "Draft replies to new inbound contacts for rep approval.",
        tools: ["ghl.contacts.read", "approval.request"],
        note: "Initial version.",
      },
    ],
  },
  {
    key: "rep.business_coach",
    name: "Business Coach",
    repRole: "BUSINESS_COACH",
    versions: [
      {
        role: "Coach the rep on habits, goals and the commission plan.",
        context: "Encouraging and specific. Explains the plan, never promises income.",
        dailyRoutine: "Morning check-in with three priorities; evening recap.",
        tools: ["report.write"],
        note: "Initial version.",
      },
    ],
  },
];

const ACTIVITY_LINES: Record<string, { kind: ActivityKind; message: string }[]> = {
  "ops-manager": [
    {
      kind: "PLANNED",
      message: "Published today's operating plan: 14 tasks across 6 departments.",
    },
    {
      kind: "DELEGATED",
      message: "Delegated the Recovery Stack series to the Content Specialist.",
    },
    {
      kind: "HANDOFF",
      message: "Handed approved posts to the Social Media Manager for scheduling.",
    },
  ],
  "affiliate-success": [
    { kind: "COMPLETED", message: "Sent onboarding checklist drafts for review (3 new reps)." },
    { kind: "REPORTED", message: "Weekly affiliate activation report filed." },
  ],
  "content-specialist": [
    { kind: "DRAFTED", message: 'Drafted post 2 of 4: "What is a recovery routine?"' },
    { kind: "COMPLIANCE_CHECKED", message: "Compliance check passed for post 2 of 4." },
    { kind: "SUBMITTED_FOR_APPROVAL", message: "Submitted post 2 of 4 to the Approval Queue." },
    {
      kind: "FLAGGED",
      message: "Compliance check flagged a draft caption for a health claim. Rewriting.",
    },
  ],
  "social-manager": [
    { kind: "STARTED", message: "Building next week's calendar for Instagram and TikTok." },
    { kind: "COMPLETED", message: "Scheduled 3 approved posts for Monday to Wednesday." },
  ],
  "finance-analyst": [
    { kind: "STARTED", message: "Reconciling October transactions with the QuickBooks export." },
    { kind: "REPORTED", message: "Software budget passed 75%. Further spend now needs approval." },
  ],
  "compliance-officer": [
    { kind: "REPORTED", message: "Reviewed TikTok policy update on health-related content." },
    {
      kind: "COMPLETED",
      message: "Added two terms to the proposed blocklist for executive review.",
    },
  ],
  "support-specialist": [
    {
      kind: "ERROR",
      message: "Help desk sync timed out after 30s. Will retry at the top of the hour.",
    },
  ],
  "systems-engineer": [
    { kind: "COMPLETED", message: "Nightly database backup verified." },
    { kind: "REPORTED", message: "All integrations healthy (mock mode)." },
  ],
  "people-ops": [
    { kind: "REPORTED", message: "Contractor review summary prepared for executive review." },
  ],
};

// ------------------------------------------------------------------ main --
async function main() {
  if ((await db.user.count()) > 0) {
    console.info("Database already has data. To re-seed run: npm run db:reset");
    return;
  }

  // Users
  const users = {} as Record<UserKey, { id: string }>;
  for (const u of USERS) {
    users[u.key] = await db.user.create({
      data: {
        name: u.name,
        email: u.email,
        role: u.role,
        title: u.title,
        status: "ACTIVE",
        onboardedAt: ago(90 * DAY),
        lastActiveAt: ago(between(0.2, 30) * HOUR),
      },
    });
  }

  // Departments
  const depts = {} as Record<DeptSlug, { id: string }>;
  for (const [i, d] of DEPARTMENTS.entries()) {
    depts[d.slug] = await db.department.create({
      data: {
        slug: d.slug,
        name: d.name,
        description: d.description,
        sortOrder: i,
        isConfidential: d.confidential,
        ownerId: users[d.owner].id,
      },
    });
  }
  for (const [key, dept] of [
    ["maya", "operations"],
    ["devon", "marketing"],
    ["rosa", "social"],
    ["nate", "sales"],
    ["alicia", "support"],
    ["isaac", "technology"],
  ] as const) {
    await db.user.update({ where: { id: users[key].id }, data: { departmentId: depts[dept].id } });
  }

  // The Brain
  const brain = await db.agent.create({
    data: {
      slug: "brain",
      name: "The Brain",
      title: "AI CEO",
      kind: "BRAIN",
      status: "ACTIVE",
      ownerId: users.guy.id,
      currentFocus:
        "Running the November content sprint and watching the Software budget, which passed 75%.",
      lastActiveAt: ago(4 * 60_000),
      monthlyBudgetUsd: usd(300),
      config: agentConfig(
        "Plan the company's day, delegate to department agents, collect their outputs and route anything external to the Approval Queue.",
        "AACTIVATED RX is a peptide education and wellness brand. Humans approve anything that leaves the company. Never make medical claims.",
        "06:00 plan the day · hourly check progress · 17:00 executive summary.",
        ["tasks.create", "handoff.create", "approval.request", "report.write"],
      ),
    },
  });

  // Company agents
  const agents: Record<string, { id: string; departmentId: string | null }> = {
    brain: { id: brain.id, departmentId: null },
  };
  for (const a of COMPANY_AGENTS) {
    agents[a.slug] = await db.agent.create({
      data: {
        slug: a.slug,
        name: a.name,
        title: a.title,
        kind: "DEPARTMENT",
        status: a.status,
        departmentId: depts[a.dept].id,
        ownerId: users[a.owner].id,
        currentFocus: a.focus,
        lastActiveAt: ago(between(0.05, 6) * HOUR),
        monthlyBudgetUsd: usd(pick([60, 80, 120, 150])),
        config: agentConfig(
          `${a.title} for ${DEPARTMENTS.find((d) => d.slug === a.dept)!.name}.`,
          "Company purposes only. Anything external goes to the Approval Queue.",
          "Check assigned tasks each morning, report progress at end of day.",
          a.tools,
        ),
      },
      select: { id: true, departmentId: true },
    });
  }

  // Agent templates + rep pods (carry forward the latest version)
  const latestVersion: Partial<
    Record<
      RepAgentRole,
      { id: string; role: string; context: string; dailyRoutine: string; toolsAllowed: string[] }
    >
  > = {};
  for (const t of REP_TEMPLATES) {
    const template = await db.agentTemplate.create({
      data: { key: t.key, name: t.name, repRole: t.repRole, currentVersion: t.versions.length },
    });
    for (const [i, v] of t.versions.entries()) {
      const created = await db.agentTemplateVersion.create({
        data: {
          templateId: template.id,
          version: i + 1,
          role: v.role,
          context: v.context,
          dailyRoutine: v.dailyRoutine,
          toolsAllowed: v.tools,
          changeNote: v.note,
          createdById: users.devon.id,
          createdAt: ago((t.versions.length - i) * 20 * DAY),
        },
      });
      latestVersion[t.repRole] = created;
    }
  }
  const pods: { rep: UserKey; roles: RepAgentRole[] }[] = [
    {
      rep: "jordan",
      roles: ["CONTENT_CREATOR", "SOCIAL_MEDIA_MANAGER", "LEAD_FOLLOWUP", "BUSINESS_COACH"],
    },
    {
      rep: "priya",
      roles: ["CONTENT_CREATOR", "SOCIAL_MEDIA_MANAGER", "LEAD_FOLLOWUP", "BUSINESS_COACH"],
    },
    { rep: "sam", roles: ["BUSINESS_COACH"] },
  ];
  for (const p of pods) {
    const pod = await db.repPod.create({ data: { repId: users[p.rep].id } });
    for (const role of p.roles) {
      const v = latestVersion[role]!;
      const t = REP_TEMPLATES.find((x) => x.repRole === role)!;
      await db.agent.create({
        data: {
          slug: `${p.rep}-${role.toLowerCase().replace(/_/g, "-")}`,
          name: t.name,
          title: t.name,
          kind: "REP_POD",
          status: "ACTIVE",
          repPodId: pod.id,
          repRole: role,
          ownerId: users[p.rep].id,
          templateVersionId: v.id,
          config: agentConfig(v.role, v.context, v.dailyRoutine, v.toolsAllowed),
          lastActiveAt: ago(between(1, 20) * HOUR),
        },
      });
    }
  }

  // Tasks
  const taskTitles: Record<string, string[]> = {
    "ops-manager": [
      "Publish daily operating plan",
      "Review department blockers",
      "Prepare weekly executive summary",
      "Route support backlog to owners",
    ],
    "affiliate-success": [
      "Onboarding checklist for new Premium reps",
      "Update Presenter criteria FAQ",
      "Follow up on inactive affiliate questions",
    ],
    "content-specialist": [
      "Recovery Stack post 1",
      "Recovery Stack post 2",
      "Recovery Stack post 3",
      "Recovery Stack post 4",
      "Rewrite flagged caption",
    ],
    "campaign-strategist": ["Q1 campaign outline"],
    "social-manager": [
      "Next week's Instagram calendar",
      "TikTok trend review (policy-safe)",
      "Schedule approved posts",
    ],
    "media-producer": ["Cut three 30-second reels", "Update brand asset library"],
    "finance-analyst": [
      "Reconcile October transactions",
      "AI spend by department report",
      "Software budget review",
    ],
    "compliance-officer": [
      "Review TikTok health content policy",
      "Propose blocklist additions",
      "Audit last week's approved posts",
    ],
    "support-specialist": ["Answer rep onboarding questions", "Sync help desk tickets"],
    "systems-engineer": [
      "Verify nightly backup",
      "Integration health review",
      "Rotate mock credentials",
    ],
    "product-developer": ["Tokenization platform scope document", "Rep onboarding flow wireframes"],
    "people-ops": ["Quarterly contractor review"],
  };
  const statuses: TaskStatus[] = ["DONE", "DONE", "IN_PROGRESS", "TODO", "IN_REVIEW", "DONE"];
  const taskIds: Record<string, string[]> = {};
  for (const [slug, titles] of Object.entries(taskTitles)) {
    taskIds[slug] = [];
    for (const [i, title] of titles.entries()) {
      let status: TaskStatus = statuses[(i + slug.length) % statuses.length]!;
      if (slug === "support-specialist" && i === 1) status = "BLOCKED";
      if (slug === "product-developer") status = i === 0 ? "BLOCKED" : "TODO";
      const done = status === "DONE";
      const t = await db.task.create({
        data: {
          title,
          status,
          priority: pick<TaskPriority>(["LOW", "MEDIUM", "MEDIUM", "HIGH", "URGENT"]),
          agentId: agents[slug]!.id,
          departmentId: agents[slug]!.departmentId,
          createdById: users.maya.id,
          dueAt:
            status === "TODO" && i === 0 && slug === "media-producer"
              ? ago(DAY)
              : ahead(between(1, 10) * DAY),
          completedAt: done ? ago(between(0.1, i % 2 ? 9 : 30) * HOUR) : null,
          createdAt: ago(between(1, 7) * DAY),
        },
      });
      taskIds[slug]!.push(t.id);
    }
  }

  // Activity feed (last ~20h)
  const feed = Object.entries(ACTIVITY_LINES).flatMap(([slug, lines]) =>
    lines.map((line) => ({ slug, line })),
  );
  for (let i = feed.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [feed[i], feed[j]] = [feed[j]!, feed[i]!];
  }
  let minutesAgo = 3;
  for (const { slug, line } of feed) {
    await db.agentActivity.create({
      data: {
        agentId: agents[slug]!.id,
        kind: line.kind,
        message: line.message,
        taskId: taskIds[slug]?.[0],
        createdAt: ago(minutesAgo * 60_000),
      },
    });
    minutesAgo += Math.round(between(8, 70));
  }
  await db.agentActivity.create({
    data: {
      agentId: brain.id,
      kind: "PLANNED",
      message: "Set today's priorities: content sprint, budget watch, rep onboarding.",
      createdAt: ago(2 * 60_000),
    },
  });

  // Handoffs & reports
  await db.handoff.createMany({
    data: [
      {
        fromAgentId: agents["ops-manager"]!.id,
        toAgentId: agents["content-specialist"]!.id,
        taskId: taskIds["content-specialist"]![0],
        status: "COMPLETED",
        note: "Brief for Recovery Stack series attached.",
        createdAt: ago(3 * DAY),
        resolvedAt: ago(2.5 * DAY),
      },
      {
        fromAgentId: agents["content-specialist"]!.id,
        toAgentId: agents["social-manager"]!.id,
        taskId: taskIds["social-manager"]![2],
        status: "PENDING",
        note: "Post 1 approved and ready to schedule.",
        createdAt: ago(5 * HOUR),
      },
      {
        fromAgentId: agents["compliance-officer"]!.id,
        toAgentId: agents["content-specialist"]!.id,
        status: "ACCEPTED",
        note: "Use the updated TikTok guidance for posts 3 and 4.",
        createdAt: ago(20 * HOUR),
      },
    ],
  });
  await db.report.createMany({
    data: [
      {
        agentId: brain.id,
        period: "DAILY",
        title: "Executive summary",
        body: "Content sprint on track (2 of 4 posts through compliance). Software budget passed 75% and is now approval-gated. Support agent sync error under investigation.",
        createdAt: ago(14 * HOUR),
      },
      {
        agentId: agents["finance-analyst"]!.id,
        period: "WEEKLY",
        title: "AI spend by department",
        body: "Marketing and Social Media account for 58% of AI spend this month.",
        createdAt: ago(2 * DAY),
      },
    ],
  });

  // Compliance rules (PLACEHOLDERS — executives must review)
  const rules: {
    type: "BLOCKLIST_TERM" | "PEPTIDE_NAME" | "MEDICAL_CLAIM" | "PLATFORM_RULE";
    pattern: string;
    isRegex?: boolean;
    channels?: ContentChannel[];
    severity: RiskLevel;
    description: string;
    suggestion?: string;
  }[] = [
    {
      type: "MEDICAL_CLAIM",
      pattern: "\\b(cures?|treats?|heals?|prevents?)\\b",
      isRegex: true,
      severity: "CRITICAL",
      description: "Medical or health claim.",
      suggestion: "Describe education or routine, not outcomes.",
    },
    {
      type: "MEDICAL_CLAIM",
      pattern: "\\b(fda[- ]approved|clinically proven|guaranteed results?)\\b",
      isRegex: true,
      severity: "CRITICAL",
      description: "Regulatory or efficacy claim.",
      suggestion: "Remove the claim.",
    },
    {
      type: "MEDICAL_CLAIM",
      pattern: "\\blose \\d+\\s?(lbs|pounds|kg)\\b",
      isRegex: true,
      severity: "HIGH",
      description: "Specific weight-loss outcome.",
    },
    {
      type: "PEPTIDE_NAME",
      pattern: "BPC-157",
      channels: ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"],
      severity: "HIGH",
      description: "Specific peptide name on social (placeholder).",
      suggestion: "Use the branded stack name, e.g. Recovery Stack.",
    },
    {
      type: "PEPTIDE_NAME",
      pattern: "TB-500",
      channels: ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"],
      severity: "HIGH",
      description: "Specific peptide name on social (placeholder).",
      suggestion: "Use the branded stack name.",
    },
    {
      type: "PEPTIDE_NAME",
      pattern: "Ipamorelin",
      channels: ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"],
      severity: "HIGH",
      description: "Specific peptide name on social (placeholder).",
      suggestion: "Use the branded stack name.",
    },
    {
      type: "BLOCKLIST_TERM",
      pattern: "miracle",
      severity: "MEDIUM",
      description: "Algorithm-trigger word (placeholder).",
    },
    {
      type: "BLOCKLIST_TERM",
      pattern: "DM me to buy",
      severity: "HIGH",
      description: "Direct sales solicitation (placeholder).",
    },
    {
      type: "PLATFORM_RULE",
      pattern: "before and after",
      channels: ["TIKTOK", "INSTAGRAM"],
      severity: "HIGH",
      description: "Before/after body comparisons are restricted on this platform.",
    },
  ];
  for (const r of rules) {
    await db.complianceRule.create({
      data: {
        type: r.type,
        pattern: r.pattern,
        isRegex: r.isRegex ?? false,
        channels: r.channels ?? [],
        severity: r.severity,
        description: r.description,
        suggestion: r.suggestion,
        createdById: users.guy.id,
      },
    });
  }

  // Content items
  const contentPlan: {
    title: string;
    channel: ContentChannel;
    status: ContentStatus;
    day: number;
    rep?: UserKey;
  }[] = [
    { title: "What is a recovery routine?", channel: "INSTAGRAM", status: "SCHEDULED", day: 2 },
    { title: "Sleep and recovery: 3 habits", channel: "FACEBOOK", status: "APPROVED", day: 4 },
    {
      title: "Recovery Stack explained (education)",
      channel: "YOUTUBE",
      status: "IN_REVIEW",
      day: 6,
    },
    {
      title: "Morning routine reel",
      channel: "TIKTOK",
      status: "IN_REVIEW",
      day: 7,
      rep: "jordan",
    },
    { title: "Meet the Recovery Stack", channel: "INSTAGRAM", status: "DRAFT", day: 9 },
    {
      title: "Rep spotlight: building habits",
      channel: "FACEBOOK",
      status: "DRAFT",
      day: 11,
      rep: "priya",
    },
    { title: "Hydration myths", channel: "TIKTOK", status: "SCHEDULED", day: 13 },
    { title: "Weekly Q&A recap", channel: "YOUTUBE", status: "DRAFT", day: 16 },
  ];
  const content: Record<string, string> = {};
  for (const c of contentPlan) {
    const item = await db.contentItem.create({
      data: {
        title: c.title,
        body: `${c.title}. Educational post in the brand voice. Learn more in our community.`,
        channel: c.channel,
        status: c.status,
        scheduledFor: new Date(monthStart.getTime() + c.day * DAY + 15 * HOUR),
        authorAgentId: c.rep ? null : agents["content-specialist"]!.id,
        repId: c.rep ? users[c.rep].id : null,
      },
    });
    content[c.title] = item.id;
  }

  // Budgets (this month)
  const budgets = {
    ai: await db.budget.create({
      data: {
        name: "AI models (company)",
        kind: "AI_MODEL",
        periodStart: monthStart,
        periodEnd: monthEnd,
        limitUsd: usd(120),
      },
    }),
    aiMarketing: await db.budget.create({
      data: {
        name: "AI models (Marketing)",
        kind: "AI_MODEL",
        departmentId: depts.marketing.id,
        periodStart: monthStart,
        periodEnd: monthEnd,
        limitUsd: usd(45),
      },
    }),
    ads: await db.budget.create({
      data: {
        name: "Advertising",
        kind: "ADVERTISING",
        departmentId: depts.marketing.id,
        periodStart: monthStart,
        periodEnd: monthEnd,
        limitUsd: usd(5000),
        status: "WARNING",
      },
    }),
    software: await db.budget.create({
      data: {
        name: "Software subscriptions",
        kind: "SOFTWARE",
        departmentId: depts.technology.id,
        periodStart: monthStart,
        periodEnd: monthEnd,
        limitUsd: usd(1200),
        status: "LOCKED",
        alertSentAt: ago(26 * HOUR),
        lockedAt: ago(26 * HOUR),
      },
    }),
  };

  // AI spend events (last 30 days), weighted by agent
  const spendWeights: [string, number][] = [
    ["brain", 3],
    ["content-specialist", 4],
    ["social-manager", 3],
    ["ops-manager", 2],
    ["affiliate-success", 1.5],
    ["finance-analyst", 1],
    ["compliance-officer", 1.5],
    ["systems-engineer", 0.5],
    ["support-specialist", 1],
  ];
  const totalWeight = spendWeights.reduce((n, [, w]) => n + w, 0);
  const events: Prisma.SpendEventCreateManyInput[] = [];
  for (let d = 29; d >= 0; d--) {
    const callsToday = Math.round(between(70, 110));
    for (let c = 0; c < callsToday; c++) {
      let r = rand() * totalWeight;
      const [slug] = spendWeights.find(([, w]) => (r -= w) < 0) ?? spendWeights[0]!;
      const isBrain = slug === "brain";
      const model = isBrain ? "claude-opus-5-5" : "claude-sonnet-5-5";
      const inputTokens = Math.round(between(2500, isBrain ? 40000 : 18000));
      const outputTokens = Math.round(between(300, isBrain ? 6000 : 3000));
      const cost = isBrain
        ? (inputTokens * 4 + outputTokens * 20) / 1e6
        : (inputTokens * 2 + outputTokens * 10) / 1e6;
      const occurredAt = new Date(
        ago(d * DAY).setHours(Math.floor(between(6, 22)), Math.floor(between(0, 59))),
      );
      if (occurredAt > NOW) continue;
      const agent = agents[slug]!;
      events.push({
        kind: "AI_MODEL",
        description: isBrain ? "Brain planning" : "Agent task",
        amountUsd: usd(cost, 6),
        agentId: agent.id,
        departmentId: agent.departmentId,
        budgetId:
          occurredAt >= monthStart
            ? agent.departmentId === depts.marketing.id
              ? budgets.aiMarketing.id
              : budgets.ai.id
            : null,
        provider: "anthropic",
        model,
        inputTokens,
        outputTokens,
        occurredAt,
      });
    }
  }
  await db.spendEvent.createMany({ data: events });
  await db.spendEvent.createMany({
    data: [
      {
        kind: "SOFTWARE",
        description: "Design tool seats",
        amountUsd: usd(420),
        budgetId: budgets.software.id,
        departmentId: depts.technology.id,
        occurredAt: new Date(monthStart.getTime() + 1 * DAY),
      },
      {
        kind: "SOFTWARE",
        description: "Video editing suite",
        amountUsd: usd(285),
        budgetId: budgets.software.id,
        departmentId: depts.technology.id,
        occurredAt: new Date(monthStart.getTime() + 2 * DAY),
      },
      {
        kind: "SOFTWARE",
        description: "Scheduling platform",
        amountUsd: usd(230),
        budgetId: budgets.software.id,
        departmentId: depts.technology.id,
        occurredAt: new Date(monthStart.getTime() + 3 * DAY),
      },
      {
        kind: "ADVERTISING",
        description: "Brand awareness campaign",
        amountUsd: usd(3150),
        budgetId: budgets.ads.id,
        departmentId: depts.marketing.id,
        occurredAt: new Date(monthStart.getTime() + 2 * DAY),
      },
    ],
  });

  // Transactions (this and last month)
  const txns: Prisma.TransactionCreateManyInput[] = [];
  for (let m = 1; m >= 0; m--) {
    const base = new Date(NOW.getFullYear(), NOW.getMonth() - m, 1);
    const days = m === 0 ? Math.max(1, NOW.getDate()) : 28;
    for (let i = 0; i < 18; i++) {
      const revenue = i % 3 !== 0;
      txns.push({
        occurredAt: new Date(base.getTime() + Math.floor(between(0, days)) * DAY + 12 * HOUR),
        description: revenue
          ? pick(["Membership renewals", "Education program sales", "Event tickets"])
          : pick([
              "Contractor invoice",
              "Software subscription",
              "Ad platform charge",
              "Shipping supplies",
            ]),
        category: revenue
          ? "Sales"
          : pick(["Contractors", "Software", "Advertising", "Operations"]),
        type: revenue ? "REVENUE" : "EXPENSE",
        amountUsd: usd(revenue ? between(800, 6400) : between(120, 2600)),
        source: "QUICKBOOKS",
        externalId: `qb-mock-${m}-${i}`,
      });
    }
  }
  await db.transaction.createMany({ data: txns });

  // Approval requests
  const approvals: {
    type: ApprovalType;
    title: string;
    summary: string;
    risk: RiskLevel;
    agent: string;
    payload: Record<string, unknown>;
    reasoning: string;
    sources: { title: string; note?: string }[];
    content?: string;
    amount?: number;
    budget?: string;
    decided?: "APPROVED" | "REJECTED";
    createdHoursAgo: number;
  }[] = [
    {
      type: "SOCIAL_POST",
      title: "Instagram: What is a recovery routine?",
      summary: "Educational carousel, 5 slides.",
      risk: "LOW",
      agent: "content-specialist",
      content: "What is a recovery routine?",
      payload: {
        channel: "INSTAGRAM",
        caption:
          "Recovery is a routine, not a moment. Here are three habits our community swears by. Which one is yours?",
      },
      reasoning:
        "Part of the approved November content sprint. Uses the branded stack name only and makes no outcome claims. Compliance check passed with no findings.",
      sources: [{ title: "Brand voice guide v3" }, { title: "November content brief" }],
      decided: "APPROVED",
      createdHoursAgo: 30,
    },
    {
      type: "SOCIAL_POST",
      title: "YouTube: Recovery Stack explained",
      summary: "8-minute education video description and title.",
      risk: "MEDIUM",
      agent: "content-specialist",
      content: "Recovery Stack explained (education)",
      payload: {
        channel: "YOUTUBE",
        title: "Recovery Stack explained",
        description: "An educational overview of how our community thinks about recovery routines.",
      },
      reasoning:
        "Long-form education drives the most saves. Medium risk because the topic sits close to health claims; wording reviewed against the compliance rules and kept educational.",
      sources: [{ title: "October engagement report" }, { title: "Compliance rules (current)" }],
      createdHoursAgo: 5,
    },
    {
      type: "SOCIAL_POST",
      title: "TikTok: Morning routine reel (Jordan Ellis)",
      summary: "Rep pod draft, 30 seconds.",
      risk: "HIGH",
      agent: "content-specialist",
      content: "Morning routine reel",
      payload: { channel: "TIKTOK", caption: "My morning routine that changed everything" },
      reasoning:
        'Rep requested a personal-story reel. Flagged HIGH: the phrase "changed everything" may read as an outcome claim on TikTok. Suggest softer wording before approval.',
      sources: [{ title: "TikTok health content policy (summary)" }],
      createdHoursAgo: 3,
    },
    {
      type: "EMAIL",
      title: "Email: November community newsletter",
      summary: "Sent to consented subscribers only.",
      risk: "LOW",
      agent: "ops-manager",
      payload: {
        audience: "Consented newsletter subscribers",
        subject: "Your November recovery guide",
      },
      reasoning:
        "Monthly newsletter. Audience is limited to contacts with recorded opt-in consent.",
      sources: [{ title: "Newsletter template" }, { title: "Consent records (GoHighLevel, mock)" }],
      createdHoursAgo: 8,
    },
    {
      type: "SPEND",
      title: "Spend: Annual design tool upgrade ($360)",
      summary: "Software budget is above 75%, so this needs approval.",
      risk: "MEDIUM",
      agent: "systems-engineer",
      amount: 360,
      budget: "software",
      payload: { vendor: "Design tool", amountUsd: 360 },
      reasoning:
        "The Software budget is at 78% of its limit. Upgrading now saves 20% versus monthly billing. Requires executive approval under the 75% rule.",
      sources: [
        { title: "Software budget (this month)" },
        { title: "Vendor pricing page (captured)" },
      ],
      createdHoursAgo: 20,
    },
    {
      type: "PROJECT_LAUNCH",
      title: "Unlock: Tokenization platform discovery",
      summary: "Move the tokenization project from Review to Build.",
      risk: "CRITICAL",
      agent: "product-developer",
      payload: { project: "Tokenization platform", from: "REVIEW", to: "BUILD" },
      reasoning:
        "Scope document is ready. This project is locked and cannot advance without an executive decision. Legal review is recommended first.",
      sources: [{ title: "Tokenization scope draft" }],
      createdHoursAgo: 48,
    },
  ];
  for (const a of approvals) {
    const created = await db.approvalRequest.create({
      data: {
        type: a.type,
        title: a.title,
        summary: a.summary,
        payload: a.payload as Prisma.InputJsonValue,
        payloadHash: hashPayload(a.payload),
        reasoning: a.reasoning,
        sources: a.sources as Prisma.InputJsonValue,
        risk: a.risk,
        requiredRole: requiredRoleFor(a.type, a.risk),
        status: a.decided ?? "PENDING",
        amountUsd: a.amount ? usd(a.amount) : null,
        budgetId: a.budget === "software" ? budgets.software.id : null,
        requestedByAgentId: agents[a.agent]!.id,
        contentItemId: a.content ? content[a.content] : null,
        decidedById: a.decided ? users.devon.id : null,
        decidedAt: a.decided ? ago((a.createdHoursAgo - 4) * HOUR) : null,
        createdAt: ago(a.createdHoursAgo * HOUR),
      },
    });
    await db.complianceCheck.create({
      data: {
        approvalRequestId: created.id,
        contentItemId: a.content ? content[a.content] : null,
        outcome: a.risk === "HIGH" || a.risk === "CRITICAL" ? "WARN" : "PASS",
        risk: a.risk,
        violations: (a.risk === "HIGH"
          ? [
              {
                type: "MEDICAL_CLAIM",
                match: "changed everything",
                message: "May read as an outcome claim.",
                severity: "HIGH",
              },
            ]
          : []) as Prisma.InputJsonValue,
        checkedAt: ago(a.createdHoursAgo * HOUR),
      },
    });
  }

  // Knowledge documents
  const docs: {
    title: string;
    category: "POLICIES" | "TRAINING" | "LEGAL_RESEARCH" | "BRAND" | "PRODUCT_EDUCATION";
    access: "EXECUTIVE_ONLY" | "ALL_STAFF" | "ALL_USERS";
    summary: string;
  }[] = [
    {
      title: "Content & posting rules",
      category: "POLICIES",
      access: "ALL_USERS",
      summary: "No medical claims, branded stack names only, platform rules apply.",
    },
    {
      title: "Lead generation policy",
      category: "POLICIES",
      access: "ALL_USERS",
      summary: "Consented inbound contacts only. No scraping, purchased lists or cold outreach.",
    },
    {
      title: "Agent usage policy",
      category: "POLICIES",
      access: "ALL_STAFF",
      summary: "Agents are for company purposes only; exceptions need management approval.",
    },
    {
      title: "Rep onboarding guide",
      category: "TRAINING",
      access: "ALL_USERS",
      summary: "First 30 days for new reps.",
    },
    {
      title: "Brand voice guide v3",
      category: "BRAND",
      access: "ALL_USERS",
      summary: "Calm, factual, encouraging.",
    },
    {
      title: "Recovery Stack education notes",
      category: "PRODUCT_EDUCATION",
      access: "ALL_USERS",
      summary: "How to talk about the Recovery Stack without claims.",
    },
    {
      title: "Regulatory landscape memo",
      category: "LEGAL_RESEARCH",
      access: "EXECUTIVE_ONLY",
      summary: "Confidential legal research.",
    },
    {
      title: "Tokenization legal considerations",
      category: "LEGAL_RESEARCH",
      access: "EXECUTIVE_ONLY",
      summary: "Confidential. Required before any tokenization launch.",
    },
  ];
  for (const d of docs) {
    await db.document.create({
      data: {
        title: d.title,
        category: d.category,
        accessLevel: d.access,
        summary: d.summary,
        body: `${d.summary}\n\n(Demo document body.)`,
        tags: [d.category.toLowerCase()],
        ownerId: d.access === "EXECUTIVE_ONLY" ? users.guy.id : users.maya.id,
      },
    });
  }

  // Prompt templates
  const prompt = await db.promptTemplate.create({
    data: {
      key: "content.educational_post",
      name: "Educational post",
      description: "Draft an educational social post for a branded stack.",
      variables: ["stack_name", "channel", "hook"],
      currentVersion: 2,
      departmentId: depts.marketing.id,
    },
  });
  await db.promptTemplateVersion.createMany({
    data: [
      {
        templateId: prompt.id,
        version: 1,
        body: "Write a {{channel}} post about {{stack_name}}. No medical claims.",
        changeNote: "Initial",
        createdById: users.devon.id,
        createdAt: ago(30 * DAY),
      },
      {
        templateId: prompt.id,
        version: 2,
        body: 'Write a {{channel}} post about {{stack_name}} that opens with the hook "{{hook}}". Educational tone, no medical or outcome claims, branded names only.',
        changeNote: "Added question hook",
        createdById: users.devon.id,
        createdAt: ago(9 * DAY),
      },
    ],
  });

  // Projects
  await db.project.createMany({
    data: [
      {
        name: "Rep onboarding flow",
        description: "Guided onboarding for new reps.",
        phase: "BUILD",
        ownerId: users.isaac.id,
        sortOrder: 1,
        targetDate: ahead(21 * DAY),
      },
      {
        name: "GoHighLevel live integration",
        description: "Contacts and Social Planner, one sub-account per Premium rep.",
        phase: "REVIEW",
        ownerId: users.isaac.id,
        sortOrder: 2,
        requiresExecutiveApproval: true,
      },
      {
        name: "QuickBooks read-only sync",
        description: "Nightly transaction import.",
        phase: "IDEA",
        ownerId: users.isaac.id,
        sortOrder: 3,
      },
      {
        name: "Rep mobile view",
        description: "Phone-first My AI Team.",
        phase: "IDEA",
        ownerId: users.isaac.id,
        sortOrder: 4,
      },
      {
        name: "Tokenization platform",
        description: "Mapped only. Not launchable without executive approval.",
        phase: "REVIEW",
        locked: true,
        requiresExecutiveApproval: true,
        isTokenization: true,
        ownerId: users.guy.id,
        sortOrder: 5,
      },
      {
        name: "Knowledge library AI search",
        description: "Semantic search with access-level filtering.",
        phase: "BUILD",
        ownerId: users.isaac.id,
        sortOrder: 6,
      },
      {
        name: "Status page",
        description: "Public uptime page.",
        phase: "LAUNCH",
        ownerId: users.isaac.id,
        sortOrder: 7,
      },
    ],
  });

  // Integrations
  await db.integration.createMany({
    data: [
      {
        provider: "GOHIGHLEVEL",
        name: "GoHighLevel",
        description: "Contacts and Social Planner. One sub-account per Premium rep.",
        mode: "MOCK",
        status: "OPERATIONAL",
        lastCheckedAt: ago(12 * 60_000),
      },
      {
        provider: "QUICKBOOKS",
        name: "QuickBooks",
        description: "Read-only accounting sync.",
        mode: "MOCK",
        status: "OPERATIONAL",
        lastCheckedAt: ago(12 * 60_000),
      },
      {
        provider: "SLACK",
        name: "Slack",
        description: "Internal team notifications.",
        mode: "MOCK",
        status: "OPERATIONAL",
        lastCheckedAt: ago(12 * 60_000),
      },
      {
        provider: "ANTHROPIC",
        name: "Claude (Anthropic)",
        description: "AI models for the Brain and agents. Mock until enabled.",
        mode: "MOCK",
        status: "OPERATIONAL",
        lastCheckedAt: ago(12 * 60_000),
      },
    ],
  });

  // Notifications
  await db.notification.createMany({
    data: [
      {
        userId: users.guy.id,
        kind: "BUDGET_ALERT",
        title: "Software budget passed 75%",
        body: "Further spend in Software subscriptions now requires your approval.",
        href: "/finance",
        createdAt: ago(26 * HOUR),
      },
      {
        userId: users.guy.id,
        kind: "APPROVAL_REQUESTED",
        title: "Tokenization project unlock requested",
        body: "The Product Developer asked to move the tokenization project to Build.",
        href: "/approvals",
        createdAt: ago(48 * HOUR),
      },
      {
        userId: users.guy.id,
        kind: "COMPLIANCE_FLAG",
        title: "High-risk TikTok draft",
        body: "A rep pod draft may read as an outcome claim.",
        href: "/approvals",
        createdAt: ago(3 * HOUR),
      },
      {
        userId: users.devon.id,
        kind: "APPROVAL_REQUESTED",
        title: "2 posts waiting for review",
        body: "Content Specialist submitted posts to the queue.",
        href: "/approvals",
        createdAt: ago(5 * HOUR),
      },
      {
        userId: users.isaac.id,
        kind: "SYSTEM",
        title: "Support agent sync error",
        body: "Help desk sync timed out. Retry scheduled.",
        href: "/admin",
        createdAt: ago(1 * HOUR),
      },
    ],
  });

  await db.auditLog.create({
    data: {
      actorType: "SYSTEM",
      action: "system.seeded",
      entityType: "System",
      metadata: {
        users: USERS.length,
        departments: DEPARTMENTS.length,
        spendEvents: events.length,
      },
    },
  });

  console.info(
    `Seeded ${USERS.length} users, ${DEPARTMENTS.length} departments, ${COMPANY_AGENTS.length + 1} company agents, ${events.length} AI spend events.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
