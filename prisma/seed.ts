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
  ApprovalType,
  ContentChannel,
  ContentStatus,
  RepAgentRole,
  RiskLevel,
  TaskPriority,
  TaskStatus,
} from "../src/generated/prisma/enums";
import { requiredRoleFor } from "../src/server/approvals/policy";
import { hashPayload } from "../src/server/approvals/payload";
import { MOCK_CONTACTS } from "../src/server/integrations/mock";
import { assistantProfile } from "../src/server/agents/assistant-profile";
import { contentHash } from "../src/server/publishing/hash";
import { coachPlanSkill, knowledgeSummarySkill } from "../src/server/agents/skills";
import {
  agentConfig,
  BRAIN,
  COMPANY_AGENTS,
  COMPLIANCE_RULES,
  DEPARTMENTS,
  departmentAgentConfig,
  PROMPT_LIBRARY,
  REP_TEMPLATES,
  type DeptSlug,
} from "./catalog";

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
    ["nate", "affiliate"],
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
      config: BRAIN.config,
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
        config: departmentAgentConfig(
          a.title,
          DEPARTMENTS.find((d) => d.slug === a.dept)!.name,
          a.tools,
        ),
      },
      select: { id: true, departmentId: true },
    });
  }

  // A personal assistant for every executive, staff member and system admin.
  for (const u of USERS.filter((x) => ["EXECUTIVE", "STAFF", "SYSTEM_ADMIN"].includes(x.role))) {
    const profile = assistantProfile({ name: u.name, role: u.role, title: u.title });
    await db.agent.create({
      data: {
        slug: `assistant-${users[u.key].id}`,
        name: profile.name,
        title: profile.title,
        kind: "PERSONAL",
        status: "ACTIVE",
        ownerId: users[u.key].id,
        monthlyBudgetUsd: usd(profile.monthlyBudgetUsd),
        currentFocus: "Ready for your next request.",
        config: profile.config,
        lastActiveAt: ago(between(1, 30) * HOUR),
      },
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
  const rules = COMPLIANCE_RULES;
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

  // Transactions (last six months, as synced from QuickBooks in mock mode)
  const txns: Prisma.TransactionCreateManyInput[] = [];
  const revenueLines = [
    { description: "Membership renewals", dept: "sales" },
    { description: "Education program sales", dept: "sales" },
    { description: "Event tickets", dept: "marketing" },
    { description: "Affiliate program fees", dept: "affiliate" },
  ] as const;
  const expenseLines = [
    { description: "Contractor invoice", category: "Contractors", dept: "development" },
    { description: "Software subscription", category: "Software", dept: "technology" },
    { description: "Ad platform charge", category: "Advertising", dept: "marketing" },
    { description: "Shipping supplies", category: "Operations", dept: "operations" },
    { description: "Video production", category: "Media", dept: "media" },
  ] as const;
  for (let m = 5; m >= 0; m--) {
    const base = new Date(NOW.getFullYear(), NOW.getMonth() - m, 1);
    const days = m === 0 ? Math.max(1, NOW.getDate()) : 28;
    // Gentle growth month over month.
    const growth = 1 + (5 - m) * 0.06;
    const count = m === 0 ? Math.max(4, Math.round((22 * days) / 30)) : 22;
    for (let i = 0; i < count; i++) {
      const revenue = i % 3 !== 0;
      const day = Math.min(days - 1, Math.floor((i / count) * days + between(0, 1)));
      const occurredAt = new Date(base.getTime() + day * DAY + 12 * HOUR);
      if (occurredAt > NOW) continue;
      if (revenue) {
        const line = pick(revenueLines);
        txns.push({
          occurredAt,
          description: line.description,
          category: "Sales",
          type: "REVENUE",
          amountUsd: usd(between(900, 5200) * growth),
          departmentId: depts[line.dept].id,
          source: "QUICKBOOKS",
          externalId: `qb-mock-${m}-${i}`,
        });
      } else {
        const line = pick(expenseLines);
        txns.push({
          occurredAt,
          description: line.description,
          category: line.category,
          type: "EXPENSE",
          amountUsd: usd(between(350, 3100) * growth),
          departmentId: depts[line.dept].id,
          source: "QUICKBOOKS",
          externalId: `qb-mock-${m}-${i}`,
        });
      }
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
        title: "What is a recovery routine?",
        caption:
          "Recovery is a routine, not a moment. Here are three habits our community swears by. Which one is yours?",
        hashtags: ["#AACTIVATED", "#Routine"],
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
        caption: "An educational overview of how our community thinks about recovery routines.",
        hashtags: ["#AACTIVATED", "#RecoveryStack", "#Education"],
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
      payload: {
        channel: "TIKTOK",
        title: "Morning routine reel",
        caption: "My morning routine that changed everything",
        hashtags: ["#AACTIVATED", "#Routine"],
      },
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
      title: "Advance: Tokenization platform to Review",
      summary: 'Move "Tokenization platform" from Build to Review.',
      risk: "CRITICAL",
      agent: "product-developer",
      payload: { project: "Tokenization platform", from: "BUILD", to: "REVIEW" },
      reasoning:
        "The scope document and wallet prototype are ready for review. The tokenization platform is mapped only: every step needs an executive decision, and legal review comes first.",
      sources: [
        { title: "Tokenization scope draft" },
        { title: "Tokenization legal considerations (executive only)" },
      ],
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
    // Only outbound content gets an automated compliance check.
    if (a.type === "SOCIAL_POST" || a.type === "EMAIL") {
      const flagged = a.risk === "HIGH" || a.risk === "CRITICAL";
      await db.complianceCheck.create({
        data: {
          approvalRequestId: created.id,
          contentItemId: a.content ? content[a.content] : null,
          outcome: flagged ? "FAIL" : "PASS",
          risk: a.risk,
          violations: (flagged
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
    // Audit trail for the seeded history.
    await db.auditLog.create({
      data: {
        actorType: "AGENT",
        actorAgentId: agents[a.agent]!.id,
        action: "approval.requested",
        entityType: "ApprovalRequest",
        entityId: created.id,
        after: { type: a.type, risk: a.risk, requiredRole: created.requiredRole },
        createdAt: ago(a.createdHoursAgo * HOUR),
      },
    });
    if (a.decided) {
      await db.auditLog.create({
        data: {
          actorType: "USER",
          actorUserId: users.devon.id,
          action: a.decided === "APPROVED" ? "approval.approved" : "approval.rejected",
          entityType: "ApprovalRequest",
          entityId: created.id,
          before: { status: "PENDING" },
          after: { status: a.decided },
          createdAt: ago((a.createdHoursAgo - 4) * HOUR),
        },
      });
    }
  }

  // The Software budget passed 75%, so the budget rule paused it and asked executives to approve
  // more spending (system-generated, as src/server/budgets/service.ts does at runtime).
  {
    const softwarePayload = {
      purpose: "continue",
      budgetId: budgets.software.id,
      budget: "Software subscriptions",
      amountUsd: 265,
      limitUsd: 1200,
      spentUsd: 935,
    };
    const lockRequest = await db.approvalRequest.create({
      data: {
        type: "SPEND",
        title: "More spending: Software subscriptions",
        summary:
          "Software subscriptions is at 78% of its $1,200.00 budget. Approve up to $265.00 more this period.",
        payload: softwarePayload,
        payloadHash: hashPayload(softwarePayload),
        reasoning:
          "Budget rule: once spend reaches 75% of a budget, more spending in it needs management approval. Software subscriptions has spent $935.00 of $1,200.00. Approving lets spending continue by up to $265.00 this period. Rejecting keeps it paused.",
        sources: [
          { title: "Software subscriptions budget, this period" },
          { title: "Business rule: approval required from 75% of a budget" },
        ] as Prisma.InputJsonValue,
        risk: "MEDIUM",
        requiredRole: requiredRoleFor("SPEND", "MEDIUM"),
        amountUsd: usd(265),
        budgetId: budgets.software.id,
        createdAt: ago(26 * HOUR),
      },
    });
    await db.auditLog.createMany({
      data: [
        {
          actorType: "SYSTEM",
          action: "budget.threshold_reached",
          entityType: "Budget",
          entityId: budgets.software.id,
          after: { spentUsd: 935, limitUsd: 1200, ratio: 0.779 },
          createdAt: ago(26 * HOUR),
        },
        {
          actorType: "SYSTEM",
          action: "budget.locked",
          entityType: "Budget",
          entityId: budgets.software.id,
          before: { status: "OK" },
          after: { status: "LOCKED", spentUsd: 935, limitUsd: 1200 },
          createdAt: ago(26 * HOUR),
        },
        {
          actorType: "SYSTEM",
          action: "approval.requested",
          entityType: "ApprovalRequest",
          entityId: lockRequest.id,
          after: { type: "SPEND", risk: "MEDIUM", requiredRole: "EXECUTIVE" },
          createdAt: ago(26 * HOUR),
        },
      ],
    });
  }

  // Email campaigns: one sent to clinics, one waiting for approval, one rep draft.
  {
    const clinicBody = [
      "Hello,",
      "Thank you for partnering with AACTIVATED RX this year. Our December education webinar for clinic teams is on December 10 at 1 pm Eastern.",
      "We will cover the new member onboarding guide, ordering and the updated education materials for your front desk.",
      "Reply to this email to save a seat for your team.",
      "Thank you,\nMaya Torres\nAACTIVATED RX",
    ].join("\n\n");
    const sent = await db.emailCampaign.create({
      data: {
        name: "December clinic webinar",
        audience: "CLINICS",
        subject: "Your invitation: December education webinar",
        body: clinicBody,
        status: "SENT",
        createdById: users.maya.id,
        recipientEstimate: 7,
        sentAt: ago(30 * HOUR),
        sentCount: 7,
        skippedCount: 1,
        createdAt: ago(3 * DAY),
      },
    });
    const sentPayload = {
      kind: "email_campaign",
      campaignId: sent.id,
      audience: "CLINICS",
      channel: "EMAIL",
      to: "Clinics (about 7)",
      subject: "Your invitation: December education webinar",
      message: clinicBody,
    };
    const sentApproval = await db.approvalRequest.create({
      data: {
        type: "EMAIL",
        title: "Email: December clinic webinar",
        summary: '"Your invitation: December education webinar" to clinics (about 7 people).',
        payload: sentPayload,
        payloadHash: hashPayload(sentPayload),
        reasoning:
          "Maya Torres wrote this email for clinics. It goes only to contacts who agreed to receive email, through GoHighLevel, with an unsubscribe link.",
        sources: [
          { title: "Audience: Clinics", note: "7 can be emailed; 1 skipped (no address)." },
        ] as Prisma.InputJsonValue,
        risk: "LOW",
        requiredRole: requiredRoleFor("EMAIL", "LOW"),
        status: "APPROVED",
        requestedByUserId: users.maya.id,
        decidedById: users.devon.id,
        decidedAt: ago(32 * HOUR),
        dispatchedAt: ago(30 * HOUR),
        createdAt: ago(2 * DAY),
      },
    });
    await db.emailCampaign.update({
      where: { id: sent.id },
      data: { approvalRequestId: sentApproval.id },
    });
    await db.complianceCheck.create({
      data: {
        approvalRequestId: sentApproval.id,
        outcome: "PASS",
        risk: "LOW",
        violations: [] as Prisma.InputJsonValue,
        checkedAt: ago(2 * DAY),
      },
    });
    await db.emailSend.createMany({
      data: MOCK_CONTACTS.clinic!.map((c) => ({
        campaignId: sent.id,
        recipientKey: c.id,
        name: c.name,
        email: c.email,
        status: c.email ? ("SENT" as const) : ("SKIPPED" as const),
        reason: c.email ? null : "No email address",
        externalId: c.email ? `mock-msg-${c.id.slice(-3)}` : null,
        createdAt: ago(30 * HOUR),
      })),
    });

    const memberBody = [
      "Hello,",
      "Here is your December update from AACTIVATED RX: new education videos in the member library, the holiday shipping schedule and a reminder about our community Q&A on December 14.",
      "As always, talk with your healthcare provider about what is right for you.",
      "Thank you for being part of the community,\nDevon Brooks\nAACTIVATED RX",
    ].join("\n\n");
    const pending = await db.emailCampaign.create({
      data: {
        name: "December member newsletter",
        audience: "MEMBERS",
        subject: "Your December update from AACTIVATED",
        body: memberBody,
        status: "IN_REVIEW",
        createdById: users.devon.id,
        recipientEstimate: 21,
        createdAt: ago(8 * HOUR),
      },
    });
    const pendingPayload = {
      kind: "email_campaign",
      campaignId: pending.id,
      audience: "MEMBERS",
      channel: "EMAIL",
      to: "Members (about 21)",
      subject: "Your December update from AACTIVATED",
      message: memberBody,
    };
    const pendingApproval = await db.approvalRequest.create({
      data: {
        type: "EMAIL",
        title: "Email: December member newsletter",
        summary: '"Your December update from AACTIVATED" to members (about 21 people).',
        payload: pendingPayload,
        payloadHash: hashPayload(pendingPayload),
        reasoning:
          "Devon Brooks wrote this email for members. It goes only to contacts who agreed to receive email, through GoHighLevel, with an unsubscribe link.",
        sources: [
          { title: "Audience: Members", note: "21 can be emailed; 3 skipped (do-not-disturb)." },
        ] as Prisma.InputJsonValue,
        risk: "LOW",
        requiredRole: requiredRoleFor("EMAIL", "LOW"),
        requestedByUserId: users.devon.id,
        createdAt: ago(6 * HOUR),
      },
    });
    await db.emailCampaign.update({
      where: { id: pending.id },
      data: { approvalRequestId: pendingApproval.id },
    });
    await db.complianceCheck.create({
      data: {
        approvalRequestId: pendingApproval.id,
        outcome: "PASS",
        risk: "LOW",
        violations: [] as Prisma.InputJsonValue,
        checkedAt: ago(6 * HOUR),
      },
    });

    await db.emailCampaign.create({
      data: {
        name: "Welcome to the Recovery challenge",
        audience: "MY_CONTACTS",
        subject: "Thanks for joining the Recovery challenge",
        body: [
          "Hi there,",
          "Thanks for signing up for the 30-day Recovery challenge. Each week I will share one simple habit and a short video from the AACTIVATED education library.",
          "Reply any time with questions.",
          "Talk soon,\nJordan",
        ].join("\n\n"),
        status: "DRAFT",
        createdById: users.jordan.id,
        repId: users.jordan.id,
        createdAt: ago(2 * HOUR),
      },
    });
  }

  // Publishing: an e-book in progress and an approved article.
  {
    const ebookChapters = [
      ["Why routines matter", "Why a steady weekly routine matters more than any single day."],
      ["The basics", "The core ideas in plain language, with the terms members will meet."],
      ["Building the habit", "A simple weekly routine to start with, and how to keep it."],
      ["Tracking progress", "What to notice, how to keep notes and when to adjust."],
      ["Common questions", "Short answers to the questions members ask most."],
      ["Next steps", "Where to learn more and how to talk with a professional."],
    ] as const;
    const written = (title: string, summary: string) =>
      [
        summary,
        `In this chapter we look at ${title.toLowerCase()} for new members. The goal is simple: understand the idea, try one small step this week, and notice what changes.`,
        "Start small. Pick one part of your routine and keep it the same for seven days. Write down what you did and how it felt. Small, steady changes are easier to keep than big ones.",
        "If you have questions about what is right for you, talk with a qualified professional. This guide is education, not medical advice.",
      ].join("\n\n");
    await db.publication.create({
      data: {
        title: "Building Your Recovery Routine",
        subtitle: "A practical guide for new members",
        kind: "EBOOK",
        audience: "new members",
        description:
          "A short member e-book on building a steady weekly recovery routine with the Recovery Stack, written in plain language.",
        authorId: users.devon.id,
        createdAt: ago(5 * DAY),
        sections: {
          create: ebookChapters.map(([title, summary], i) => ({
            position: i + 1,
            title,
            summary,
            body: i < 2 ? written(title, summary) : "",
            writtenBy: i < 2 ? "Book & E-book Author (Chapter)" : null,
          })),
        },
      },
    });

    const articleSections = [
      {
        title: "Start with sleep",
        body: "Consistent sleep is the base of every routine. Pick a bedtime you can keep on weekdays and weekends, and protect the hour before it.\n\nSmall, steady changes are easier to keep than big ones.",
      },
      {
        title: "Move a little every day",
        body: "A short walk after meals or ten minutes of stretching counts. The habit matters more than the intensity.\n\nWrite down what you did so you can see the streak grow.",
      },
      {
        title: "Plan the week ahead",
        body: "Every Sunday, look at the week and choose two times for your routine. Put them in your calendar like any other appointment.\n\nThis guide is education, not medical advice. Talk with a qualified professional about what is right for you.",
      },
    ];
    const article = await db.publication.create({
      data: {
        title: "Three habits for a steadier week",
        kind: "ARTICLE",
        audience: "members and blog readers",
        description: "A short blog article on simple weekly habits that support recovery.",
        status: "APPROVED",
        authorId: users.devon.id,
        approvedAt: ago(20 * HOUR),
        createdAt: ago(3 * DAY),
        sections: {
          create: articleSections.map((x, i) => ({
            position: i + 1,
            title: x.title,
            summary: "",
            body: x.body,
            writtenBy: "Staff Writer (Inkwell)",
          })),
        },
      },
    });
    const hash = contentHash({ title: article.title, subtitle: null, sections: articleSections });
    const words = articleSections.reduce((n, x) => n + x.body.split(/\s+/).length, 0);
    const payload = {
      kind: "publication",
      publicationId: article.id,
      title: article.title,
      format: "ARTICLE",
      parts: articleSections.length,
      words,
      contentHash: hash,
    };
    const approval = await db.approvalRequest.create({
      data: {
        type: "PUBLICATION",
        title: `Publish: ${article.title}`,
        summary: `Article for members and blog readers: 3 sections, about ${words} words.`,
        payload,
        payloadHash: hashPayload(payload),
        reasoning:
          "Devon Brooks sent this article for approval to publish outside the company. Approval covers exactly this version.",
        sources: [
          { title: `Manuscript: ${article.title}`, url: `/content/publishing/${article.id}` },
        ] as Prisma.InputJsonValue,
        risk: "LOW",
        requiredRole: requiredRoleFor("PUBLICATION", "LOW"),
        status: "APPROVED",
        requestedByUserId: users.devon.id,
        decidedById: users.guy.id,
        decidedAt: ago(20 * HOUR),
        decisionNote: "Good to publish on the blog.",
        createdAt: ago(26 * HOUR),
      },
    });
    await db.publication.update({
      where: { id: article.id },
      data: { approvalRequestId: approval.id, approvedHash: hash },
    });
  }

  // A limit change a staff member asked for, waiting for Guy in the Approval Queue.
  {
    const payload = { budgetId: budgets.ads.id, fromLimitUsd: 5000, toLimitUsd: 6500 };
    const request = await db.approvalRequest.create({
      data: {
        type: "BUDGET_CHANGE",
        title: "Budget: Advertising limit $5,000.00 to $6,500.00",
        summary:
          "Raise the Advertising limit from $5,000.00 to $6,500.00. Spending so far is shown on the Budgets page.",
        payload,
        payloadHash: hashPayload(payload),
        reasoning:
          "Devon Brooks asked for this change: two extra member-education campaigns launch in the second half of November and need paid reach on Facebook and Instagram.",
        sources: [
          { title: "Advertising (Marketing)", note: "Requested from the Budgets page." },
        ] as Prisma.InputJsonValue,
        risk: "LOW",
        requiredRole: requiredRoleFor("BUDGET_CHANGE", "LOW"),
        requestedByUserId: users.devon.id,
        budgetId: budgets.ads.id,
        createdAt: ago(5 * HOUR),
      },
    });
    await db.auditLog.create({
      data: {
        actorType: "USER",
        actorUserId: users.devon.id,
        action: "approval.requested",
        entityType: "ApprovalRequest",
        entityId: request.id,
        after: { type: "BUDGET_CHANGE", risk: "LOW", requiredRole: "EXECUTIVE" },
        createdAt: ago(5 * HOUR),
      },
    });
  }

  // Knowledge documents (demo content; summaries come from the same skill the app uses)
  const docs: {
    title: string;
    category: "POLICIES" | "TRAINING" | "LEGAL_RESEARCH" | "BRAND" | "PRODUCT_EDUCATION";
    access: "EXECUTIVE_ONLY" | "ALL_STAFF" | "ALL_USERS";
    owner: "guy" | "maya" | "devon" | "isaac";
    tags: string[];
    daysAgo: number;
    /** Leave unsummarized to show the "Generate summary" step. */
    noSummary?: boolean;
    body: string;
  }[] = [
    {
      title: "Content & posting rules",
      category: "POLICIES",
      access: "ALL_USERS",
      owner: "maya",
      tags: ["compliance", "social", "content"],
      daysAgo: 3,
      body: `These rules apply to every post, email and message written by staff, reps or agents. They keep our accounts in good standing and keep us honest with our community.
Every draft goes through the automated compliance check before it reaches a human reviewer. Anything outside these rules goes to the management review queue.
- Never make medical or health claims, or promise outcomes.
- Use branded stack names on social media, never specific peptide names.
- Avoid the words on the algorithm blocklist; the compliance check lists them.
- Follow each platform's own rules for promotions and disclosures.
- Nothing is published until a person approves it.`,
    },
    {
      title: "Lead generation policy",
      category: "POLICIES",
      access: "ALL_USERS",
      owner: "maya",
      tags: ["leads", "consent", "outreach"],
      daysAgo: 12,
      body: `We only contact people who reached out to us or opted in. Every contact needs a consent record that says how and when they opted in.
This protects our community and our accounts. It is also the law in many places.
- Consented inbound contacts only.
- No scraping, purchased lists, cold DMs, follows or comments.
- Record the consent source and the date for every contact.
- Stop immediately when someone opts out.`,
    },
    {
      title: "Agent usage policy",
      category: "POLICIES",
      access: "ALL_STAFF",
      owner: "devon",
      tags: ["agents", "ai"],
      daysAgo: 20,
      body: `Our AI agents work for the company. They plan, draft and report, and people decide.
Agents may only be used for company purposes. Outside work needs a management-approved exception with a limited scope and an end date.
- Every agent has a named human owner.
- Agents never send anything outside the company without approval.
- AI spend is tracked per agent and per department.
- Budgets pause at 75% until an executive approves more.`,
    },
    {
      title: "Information security policy",
      category: "POLICIES",
      access: "ALL_STAFF",
      owner: "isaac",
      tags: ["security", "access"],
      daysAgo: 30,
      body: `This policy explains how we protect company and member data. It covers accounts, devices and sharing.
Access follows roles. Executive-only areas such as legal, corporate accounting and HR records are restricted on the server, not just hidden.
- Use the magic-link sign-in; never share accounts.
- Report a lost device or a suspicious message to the System Admin the same day.
- Keep member data inside approved systems.
- API keys and secrets never go in documents or chat.`,
    },
    {
      title: "Rep onboarding guide",
      category: "TRAINING",
      access: "ALL_USERS",
      owner: "maya",
      tags: ["reps", "onboarding"],
      daysAgo: 6,
      body: `Welcome to the team. This guide covers your first 30 days as a representative.
Your AI team is ready when you accept the posting rules. Your Business Coach plans each week with you.
- Week 1: accept the rules and meet your AI team.
- Week 2: publish your first approved posts.
- Week 3: follow up with consented contacts only.
- Week 4: review your progress with your coach.`,
    },
    {
      title: "Using your AI team",
      category: "TRAINING",
      access: "ALL_USERS",
      owner: "maya",
      tags: ["reps", "agents"],
      daysAgo: 9,
      body: `Your AI team has four members: a Content Creator, a Social Media Manager, a Lead Follow-up Specialist and a Business Coach.
They draft and plan. The company approves anything that goes out, so expect a short review before posts and messages are sent.
- Ask your Content Creator for a post and pick a channel.
- Schedule approved posts in the Content Studio.
- Ask for follow-ups only for contacts who opted in.
- Use the weekly plan to stay consistent.`,
    },
    {
      title: "Approval queue reviewer guide",
      category: "TRAINING",
      access: "ALL_STAFF",
      owner: "devon",
      tags: ["approvals", "compliance"],
      daysAgo: 15,
      body: `Reviewers decide what leaves the company. Read the agent's reasoning and sources before you approve.
Restricted items such as spend, legal and launches need an executive. You cannot approve your own request.
- Check the compliance result first.
- Edit the content if a small change fixes it; the check runs again.
- Approving a failed check needs a written acknowledgement.
- Reject with a short note so the agent can learn.`,
    },
    {
      title: "Brand voice guide v3",
      category: "BRAND",
      access: "ALL_USERS",
      owner: "maya",
      tags: ["brand", "voice"],
      daysAgo: 25,
      body: `Our voice is calm, factual and encouraging. We teach; we do not sell hard.
Write the way a knowledgeable friend talks. Short sentences, plain words, one idea at a time.
- Lead with something useful.
- Invite questions instead of making promises.
- Use branded stack names, not ingredient names, on social.
- No hype words, no countdown pressure.`,
    },
    {
      title: "Visual identity basics",
      category: "BRAND",
      access: "ALL_STAFF",
      owner: "maya",
      tags: ["brand", "design"],
      daysAgo: 40,
      noSummary: true,
      body: `Our visual identity is dark navy with electric blue accents and clean white type. Keep layouts simple with plenty of space.
Photos show real routines and real people, never before-and-after comparisons.
- Use the approved color palette only.
- One headline per graphic.
- Captions must match the graphic's message.
- No product claims in images.`,
    },
    {
      title: "Recovery Stack education notes",
      category: "PRODUCT_EDUCATION",
      access: "ALL_USERS",
      owner: "maya",
      tags: ["recovery stack", "education"],
      daysAgo: 4,
      body: `How to talk about the Recovery Stack in education content. We explain routines and habits; we never claim results.
Questions about health go to a qualified professional, and we say so.
- Describe the routine, not an outcome.
- Use the branded name "Recovery Stack" on social.
- Point people to the education program for detail.
- Never compare against medications.`,
    },
    {
      title: "Morning Routine Stack FAQ",
      category: "PRODUCT_EDUCATION",
      access: "ALL_USERS",
      owner: "maya",
      tags: ["morning routine", "faq"],
      daysAgo: 11,
      noSummary: true,
      body: `Answers to the questions we hear most about the Morning Routine Stack. Keep answers educational and point to the program for detail.
When someone asks about a health condition, recommend they speak with a qualified professional.
- What is it: a structured morning routine people follow with our education program.
- Who is it for: members who want a consistent start to the day.
- What we never say: that it treats, cures or prevents anything.`,
    },
    {
      title: "Regulatory landscape memo",
      category: "LEGAL_RESEARCH",
      access: "EXECUTIVE_ONLY",
      owner: "guy",
      tags: ["legal", "regulatory"],
      daysAgo: 18,
      body: `Confidential legal research on the regulatory landscape for education and wellness brands. Prepared for executive review.
Rules on health claims and promotions differ by platform and by state. Counsel recommends keeping all public content educational.
- Health claims carry the highest risk; keep the automated check strict.
- Affiliate disclosures must be clear on every platform.
- Review this memo each quarter with counsel.`,
    },
    {
      title: "Tokenization legal considerations",
      category: "LEGAL_RESEARCH",
      access: "EXECUTIVE_ONLY",
      owner: "guy",
      tags: ["legal", "tokenization"],
      daysAgo: 8,
      body: `Confidential. Legal questions to settle before any tokenization launch. The project stays locked until an executive approves.
Counsel needs to review securities, consumer protection and tax treatment before a build starts.
- No public mention of tokenization until counsel signs off.
- Any launch needs executive approval in the Approval Queue.
- Keep the scope document in this library, executive-only.`,
    },
    {
      title: "Commission plan overview",
      category: "TRAINING",
      access: "ALL_USERS",
      owner: "devon",
      tags: ["commission", "reps"],
      daysAgo: 22,
      body: `How earnings are tracked in the Back Office. Figures are records of what was earned, not promises of future income.
The plan shown in the app is a placeholder until the final plan is approved.
- Earnings show as pending until they are approved.
- Payouts are listed with their reference numbers.
- Presenter status depends on the plan's requirements.`,
    },
  ];
  for (const d of docs) {
    const summary = d.noSummary
      ? null
      : knowledgeSummarySkill.mock({ title: d.title, body: d.body });
    await db.document.create({
      data: {
        title: d.title,
        category: d.category,
        accessLevel: d.access,
        summary: summary?.summary ?? null,
        keyPoints: summary?.keyPoints ?? [],
        summarizedAt: summary ? ago(d.daysAgo * DAY - HOUR) : null,
        body: d.body,
        tags: d.tags,
        ownerId: users[d.owner].id,
        createdAt: ago(d.daysAgo * DAY),
        updatedAt: ago(d.daysAgo * DAY),
      },
    });
  }

  // Prompt templates, each with its version history
  const promptLibrary = PROMPT_LIBRARY;
  for (const t of promptLibrary) {
    const last = t.versions[t.versions.length - 1]!;
    const created = await db.promptTemplate.create({
      data: {
        key: t.key,
        name: t.name,
        description: t.description,
        variables: [
          ...new Set([...last.body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((m) => m[1]!)),
        ],
        currentVersion: t.versions.length,
        departmentId: t.dept ? depts[t.dept].id : null,
        createdAt: ago(t.versions[0]!.daysAgo * DAY),
        updatedAt: ago(last.daysAgo * DAY),
      },
    });
    await db.promptTemplateVersion.createMany({
      data: t.versions.map((v, i) => ({
        templateId: created.id,
        version: i + 1,
        body: v.body,
        changeNote: v.note,
        createdById: users[t.author].id,
        createdAt: ago(v.daysAgo * DAY - i * HOUR),
      })),
    });
  }

  // Projects on the Development & Tokenization Map, plus the ideas backlog
  const projects: Prisma.ProjectCreateManyInput[] = [
    {
      name: "AI Brain portal",
      description: "The internal operating system for staff, agents and reps.",
      phase: "LAUNCH",
      progress: 100,
      ownerId: users.isaac.id,
      sortOrder: 1,
      stageNotes: {
        IDEA: "One place for the company's AI team.",
        BUILD: "Command Center, agents and approvals.",
        REVIEW: "Security, access and compliance review.",
        LAUNCH: "Live for staff and reps.",
      },
    },
    {
      name: "Rep onboarding flow",
      description: "Guided onboarding for new reps.",
      phase: "BUILD",
      progress: 72,
      ownerId: users.isaac.id,
      sortOrder: 2,
      targetDate: ahead(21 * DAY),
      stageNotes: {
        IDEA: "First 30 days for new reps.",
        BUILD: "Rules, AI team setup and weekly plan.",
      },
    },
    {
      name: "GoHighLevel live integration",
      description: "Contacts and Social Planner, one sub-account per Premium rep.",
      phase: "REVIEW",
      progress: 40,
      requiresExecutiveApproval: true,
      ownerId: users.isaac.id,
      sortOrder: 3,
      stageNotes: {
        IDEA: "Replace the mock with the real account.",
        BUILD: "Adapter behind a feature flag.",
        REVIEW: "Credentials, consent and send limits.",
      },
    },
    {
      name: "QuickBooks read-only sync",
      description: "Import transactions into Finance & Budget. Nothing written back.",
      phase: "BUILD",
      progress: 55,
      ownerId: users.isaac.id,
      sortOrder: 4,
      stageNotes: {
        IDEA: "Real figures on the Finance page.",
        BUILD: "Read-only adapter and import.",
      },
    },
    {
      name: "Tokenization platform",
      description: "Mapped only. Not launchable without executive approval.",
      phase: "BUILD",
      progress: 35,
      locked: true,
      requiresExecutiveApproval: true,
      isTokenization: true,
      ownerId: users.guy.id,
      sortOrder: 5,
      stageNotes: {
        IDEA: "Explore tokenized member rewards.",
        BUILD: "Scope, wallet prototype and legal questions.",
      },
    },
    {
      name: "Knowledge library AI search",
      description: "Semantic search with access-level filtering.",
      phase: "IDEA",
      progress: 20,
      ownerId: users.isaac.id,
      sortOrder: 6,
      stageNotes: { IDEA: "Ask questions across documents you can read." },
    },
    {
      name: "Status page",
      description: "Public uptime page.",
      phase: "LAUNCH",
      progress: 100,
      ownerId: users.isaac.id,
      sortOrder: 7,
      stageNotes: { LAUNCH: "Live at /status." },
    },
    ...[
      ["Rep mobile app", "Phone-first My AI Team for reps."],
      ["Affiliate leaderboard", "Weekly recognition for consistent reps."],
      ["AI governance assistant", "Policy, risk and compliance checks for new agents."],
      ["Member education portal", "Self-serve courses for the education program."],
    ].map(([name, description], i): Prisma.ProjectCreateManyInput => ({
      name: name!,
      description: description!,
      phase: "IDEA",
      onMap: false,
      ownerId: users.maya.id,
      sortOrder: 20 + i,
      createdAt: ago((4 - i) * 3 * DAY),
    })),
  ];
  await db.project.createMany({ data: projects });
  // The tokenization platform's pending step is the PROJECT_LAUNCH request seeded above.
  const tokenRequest = await db.approvalRequest.findFirstOrThrow({
    where: { type: "PROJECT_LAUNCH", title: "Advance: Tokenization platform to Review" },
  });
  await db.project.updateMany({
    where: { isTokenization: true },
    data: { approvalRequestId: tokenRequest.id },
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
        config: { lastSyncAt: ago(42 * 60_000).toISOString(), syncedTransactions: txns.length },
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

  // Rep profiles, team, contacts, earnings, payouts, weekly plan (Phase 3)
  const downline = [
    { name: "Taylor Reed", email: "taylor@aactivated.test", sponsor: "jordan", monthsAgo: 4 },
    { name: "Morgan Lee", email: "morgan@aactivated.test", sponsor: "jordan", monthsAgo: 2 },
    { name: "Casey Patel", email: "casey@aactivated.test", sponsor: "jordan", monthsAgo: 1 },
    // Not onboarded yet: signing in as Riley shows the rep onboarding flow.
    { name: "Riley Chen", email: "riley@aactivated.test", sponsor: "priya", monthsAgo: 0 },
  ] as const;
  const monthsAgo = (n: number) => new Date(NOW.getFullYear(), NOW.getMonth() - n, 1);

  await db.repProfile.create({
    data: {
      userId: users.jordan.id,
      presenterStatus: "PRESENTER",
      ghlSubAccountId: "mock-sub-001",
      policiesAcceptedAt: ago(200 * DAY),
      joinedAt: monthsAgo(9),
    },
  });
  await db.repProfile.create({
    data: {
      userId: users.priya.id,
      presenterStatus: "CANDIDATE",
      sponsorId: users.jordan.id,
      ghlSubAccountId: "mock-sub-002",
      policiesAcceptedAt: ago(150 * DAY),
      joinedAt: monthsAgo(5),
    },
  });
  await db.repProfile.create({
    data: {
      userId: users.sam.id,
      presenterStatus: "NONE",
      sponsorId: users.jordan.id,
      policiesAcceptedAt: ago(60 * DAY),
      joinedAt: monthsAgo(3),
    },
  });
  for (const d of downline) {
    const u = await db.user.create({
      data: {
        name: d.name,
        email: d.email,
        role: "FREE_REP",
        title: "Free Rep (demo team member)",
        status: "ACTIVE",
        onboardedAt: d.monthsAgo > 0 ? monthsAgo(d.monthsAgo) : null,
      },
    });
    await db.repProfile.create({
      data: {
        userId: u.id,
        sponsorId: users[d.sponsor].id,
        joinedAt: new Date(monthsAgo(d.monthsAgo).getTime() + 5 * DAY),
        policiesAcceptedAt: d.monthsAgo > 0 ? monthsAgo(d.monthsAgo) : null,
      },
    });
    if (d.monthsAgo > 0) {
      const pod = await db.repPod.create({ data: { repId: u.id } });
      const v = latestVersion.BUSINESS_COACH!;
      await db.agent.create({
        data: {
          slug: `pod-${u.id}-business-coach`,
          name: "Business Coach",
          title: "Business Coach",
          kind: "REP_POD",
          status: "ACTIVE",
          repPodId: pod.id,
          repRole: "BUSINESS_COACH",
          ownerId: u.id,
          templateVersionId: v.id,
          config: agentConfig(v.role, v.context, v.dailyRoutine, v.toolsAllowed),
        },
      });
    }
  }

  const earningPlan: { rep: UserKey; base: number }[] = [
    { rep: "jordan", base: 640 },
    { rep: "priya", base: 210 },
    { rep: "sam", base: 35 },
  ];
  for (const { rep, base } of earningPlan) {
    for (let m = 5; m >= 0; m--) {
      const period = monthsAgo(m);
      const growth = 1 + (5 - m) * 0.12;
      const status = m === 0 ? "PENDING" : m === 1 ? "APPROVED" : "PAID";
      const commission = Number((base * growth * between(0.9, 1.1)).toFixed(2));
      await db.earning.create({
        data: {
          repId: users[rep].id,
          period,
          kind: "COMMISSION",
          status,
          amountUsd: usd(commission),
          description: "Monthly commission",
        },
      });
      if (rep === "jordan" && m % 2 === 0) {
        await db.earning.create({
          data: {
            repId: users[rep].id,
            period,
            kind: "OVERRIDE",
            status,
            amountUsd: usd(base * 0.18),
            description: "Team override",
          },
        });
      }
      if (status === "PAID") {
        const paid = commission + (rep === "jordan" && m % 2 === 0 ? base * 0.18 : 0);
        await db.payout.create({
          data: {
            repId: users[rep].id,
            amountUsd: usd(paid),
            paidAt: new Date(period.getFullYear(), period.getMonth() + 1, 15),
            method: "Direct deposit",
            reference: `PO-${period.getFullYear()}${String(period.getMonth() + 1).padStart(2, "0")}-${rep.toUpperCase()}`,
          },
        });
      }
    }
  }

  await db.contact.createMany({
    data: [
      {
        repId: users.jordan.id,
        name: "Alex Morgan",
        email: "alex.morgan@example.test",
        preferredChannel: "EMAIL",
        consentSource: "WEB_FORM",
        consentAt: ago(2 * DAY),
        consentEvidence: "Requested the Recovery guide on the website form",
        status: "NEW",
      },
      {
        repId: users.jordan.id,
        name: "Sam Rivera",
        email: "sam.rivera@example.test",
        preferredChannel: "INSTAGRAM",
        consentSource: "INBOUND_MESSAGE",
        consentAt: ago(5 * DAY),
        consentEvidence: "Sent a DM asking about the weekly Q&A",
        status: "NEW",
      },
      {
        repId: users.jordan.id,
        name: "Jamie Brooks",
        email: "jamie.brooks@example.test",
        preferredChannel: "EMAIL",
        consentSource: "EVENT_SIGNUP",
        consentAt: ago(20 * DAY),
        consentEvidence: "Signed up at the October community event",
        status: "FOLLOWING_UP",
        lastContactedAt: ago(6 * DAY),
      },
      {
        repId: users.jordan.id,
        name: "Drew Kim",
        email: "drew.kim@example.test",
        preferredChannel: "EMAIL",
        consentSource: "WEB_FORM",
        consentAt: ago(40 * DAY),
        consentEvidence: "Newsletter sign-up form",
        status: "OPTED_OUT",
      },
      {
        repId: users.priya.id,
        name: "Chris Lane",
        email: "chris.lane@example.test",
        preferredChannel: "EMAIL",
        consentSource: "REFERRAL_OPT_IN",
        consentAt: ago(3 * DAY),
        consentEvidence: "Referred by a member and opted in by email",
        status: "NEW",
      },
    ],
  });

  // This week's coach plan for Jordan and Sam (same shape the Business Coach produces).
  const weekStart = new Date(NOW);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  for (const rep of ["jordan", "sam"] as const) {
    const premium = rep === "jordan";
    const plan = coachPlanSkill.mock({
      repName: USERS.find((u) => u.key === rep)!.name,
      plan: premium ? "PREMIUM" : "FREE",
      presenterStatus: "NONE",
      monthEarningsUsd: 0,
      newContacts: premium ? 2 : 0,
    });
    const podAgents = await db.agent.findMany({
      where: { repPod: { repId: users[rep].id } },
      select: { id: true, repRole: true },
    });
    const coachId = podAgents.find((a) => a.repRole === "BUSINESS_COACH")!.id;
    const parent = await db.task.create({
      data: {
        title: `Weekly plan: week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        description: plan.focus,
        status: "IN_PROGRESS",
        agentId: coachId,
        createdById: users[rep].id,
        dueAt: new Date(weekStart.getTime() + 4 * DAY + 17 * HOUR),
      },
    });
    for (const [i, day] of plan.days.entries()) {
      const due = new Date(weekStart.getTime() + i * DAY + 17 * HOUR);
      for (const action of day.actions) {
        const isPast = due.getTime() < NOW.getTime() - 12 * HOUR;
        await db.task.create({
          data: {
            title: action.title,
            parentId: parent.id,
            createdById: users[rep].id,
            dueAt: due,
            status: isPast ? "DONE" : "TODO",
            completedAt: isPast ? due : null,
            agentId: podAgents.find((a) => a.repRole === action.owner)?.id ?? coachId,
          },
        });
      }
    }
    await db.report.create({
      data: {
        agentId: coachId,
        period: "WEEKLY",
        title: "This week",
        body: `${plan.focus}\n\n${plan.encouragement}`,
        createdAt: weekStart,
      },
    });
  }

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

  // 30 days of health-check history (every 6 hours) so uptime figures are meaningful.
  const checks: Prisma.HealthCheckCreateManyInput[] = [];
  for (let h = 30 * 24; h > 0; h -= 6) {
    const down = h === 300; // one recorded blip
    checks.push({
      component: "database",
      status: down ? "DOWN" : "OPERATIONAL",
      latencyMs: down ? null : Math.round(between(4, 18)),
      message: down ? "Connection timeout (seeded example)." : "Connected.",
      checkedAt: ago(h * HOUR),
    });
  }
  await db.healthCheck.createMany({ data: checks });

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
