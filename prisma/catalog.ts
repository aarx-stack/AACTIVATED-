/**
 * The company's structure: departments, agents, rep agent templates, starter compliance rules
 * and the prompt library. Shared by the demo seed and the production setup, so both build the
 * same company. Owner keys name the demo people; production maps them to the real executive
 * and system admin.
 */
import type {
  AgentStatus,
  ContentChannel,
  RepAgentRole,
  RiskLevel,
} from "../src/generated/prisma/enums";

/** Demo owner keys. */
export type OwnerKey = "guy" | "isaac" | "maya" | "devon" | "rosa" | "nate" | "alicia";

export function agentConfig(
  role: string,
  context: string,
  dailyRoutine: string,
  toolsAllowed: string[],
) {
  return { role, context, dailyRoutine, toolsAllowed };
}

export const BRAIN = {
  slug: "brain",
  name: "The Brain",
  title: "AI CEO",
  monthlyBudgetUsd: 300,
  config: agentConfig(
    "Plan the company's day, delegate to department agents, collect their outputs and route anything external to the Approval Queue.",
    "AACTIVATED RX is a peptide education and wellness brand. Humans approve anything that leaves the company. Never make medical claims.",
    "06:00 plan the day · hourly check progress · 17:00 executive summary.",
    [
      "tasks.create",
      "handoff.create",
      "approval.request",
      "report.write",
      "knowledge.summarize",
      "prompts.write",
      "tasks.work",
    ],
  ),
};

/** The configuration every department agent gets. */
export function departmentAgentConfig(title: string, departmentName: string, tools: string[]) {
  return agentConfig(
    `${title} for ${departmentName}.`,
    "Company purposes only. Anything external goes to the Approval Queue.",
    "Check assigned tasks each morning, report progress at end of day.",
    [...tools, "tasks.work"],
  );
}

export const INTEGRATIONS = [
  {
    provider: "GOHIGHLEVEL" as const,
    name: "GoHighLevel",
    description: "Contacts and Social Planner. One sub-account per Premium rep.",
  },
  {
    provider: "QUICKBOOKS" as const,
    name: "QuickBooks",
    description: "Read-only accounting sync.",
  },
  { provider: "SLACK" as const, name: "Slack", description: "Internal team notifications." },
  {
    provider: "ANTHROPIC" as const,
    name: "Claude (Anthropic)",
    description: "AI models for the Brain and agents. Mock until enabled.",
  },
];

export const DEPARTMENTS = [
  {
    slug: "operations",
    name: "Operations",
    owner: "maya",
    confidential: false,
    description: "Runs the daily plan, routes work between departments and keeps SLAs.",
  },
  {
    slug: "sales",
    name: "Sales",
    owner: "guy",
    confidential: false,
    description:
      "Clinic partnerships and member sales. Consented inbound leads only: no scraping, purchased lists, cold DMs, follows or comments.",
  },
  {
    slug: "affiliate",
    name: "Affiliate Success",
    owner: "nate",
    confidential: false,
    description: "Onboards and supports reps and affiliates.",
  },
  {
    slug: "marketing",
    name: "Marketing",
    owner: "devon",
    confidential: false,
    description: "Campaigns, brand messaging and compliant educational content.",
  },
  {
    slug: "publishing",
    name: "Publishing",
    owner: "devon",
    confidential: false,
    description:
      "Articles, books and e-books: editorial calendar, writing and editing. Nothing is published outside the company without approval.",
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
export type DeptSlug = (typeof DEPARTMENTS)[number]["slug"];

export const COMPANY_AGENTS: {
  slug: string;
  name: string;
  title: string;
  dept: DeptSlug;
  owner: OwnerKey;
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
    dept: "affiliate",
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
  // Sales: clinics and members. Consented inbound leads only.
  {
    slug: "clinic-partnerships",
    name: "Mercer",
    title: "Clinic Partnerships Manager",
    dept: "sales",
    owner: "guy",
    status: "ACTIVE",
    focus: "Preparing replies for four clinics that asked about partner accounts.",
    tools: ["ghl.contacts.read", "report.write", "approval.request"],
  },
  {
    slug: "sales-development",
    name: "Pace",
    title: "Sales Development Representative",
    dept: "sales",
    owner: "guy",
    status: "ACTIVE",
    focus: "Qualifying this week's inbound demo requests (opted-in contacts only).",
    tools: ["ghl.contacts.read", "approval.request"],
  },
  {
    slug: "sales-ops",
    name: "Tally",
    title: "Sales Operations Analyst",
    dept: "sales",
    owner: "guy",
    status: "IDLE",
    focus: "Weekly pipeline report ready for Monday.",
    tools: ["report.write"],
  },
  // Publishing: articles, books and e-books.
  {
    slug: "managing-editor",
    name: "Folio",
    title: "Managing Editor",
    dept: "publishing",
    owner: "devon",
    status: "ACTIVE",
    focus: "Planning the Q1 editorial calendar: eight articles and one member e-book.",
    tools: ["content.plan", "report.write"],
  },
  {
    slug: "staff-writer",
    name: "Inkwell",
    title: "Staff Writer",
    dept: "publishing",
    owner: "devon",
    status: "ACTIVE",
    focus: "Drafting the recovery-routines article series.",
    tools: ["content.draft", "compliance.check"],
  },
  {
    slug: "book-author",
    name: "Chapter",
    title: "Book & E-book Author",
    dept: "publishing",
    owner: "devon",
    status: "ACTIVE",
    focus: "Outlining the member e-book Building Your Recovery Routine.",
    tools: ["content.draft", "knowledge.summarize"],
  },
  {
    slug: "copy-editor",
    name: "Redline",
    title: "Copy Editor",
    dept: "publishing",
    owner: "devon",
    status: "IDLE",
    focus: "Style and compliance pass on two finished articles.",
    tools: ["compliance.check", "content.draft"],
  },
];

export const REP_TEMPLATES: {
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

export const COMPLIANCE_RULES: {
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

export const PROMPT_LIBRARY: {
  key: string;
  name: string;
  description: string;
  dept: DeptSlug | null;
  author: OwnerKey;
  versions: { body: string; note: string; daysAgo: number }[];
}[] = [
  {
    key: "content.educational_post",
    name: "Educational post",
    description: "Draft an educational social post for a branded stack.",
    dept: "marketing",
    author: "devon",
    versions: [
      {
        body: "Write a {{channel}} post about {{stack_name}}. No medical claims.",
        note: "Initial template",
        daysAgo: 30,
      },
      {
        body: 'Write a {{channel}} post about {{stack_name}} that opens with the hook "{{hook}}". Educational tone, no medical or outcome claims, branded names only.',
        note: "Added question hook",
        daysAgo: 9,
      },
    ],
  },
  {
    key: "content.launch_email",
    name: "Product launch email",
    description: "A launch email to consented subscribers, with subject line options.",
    dept: "marketing",
    author: "maya",
    versions: [
      {
        body: "You are a marketing copywriter at AACTIVATED. Write a launch email for {{product_name}} to {{target_audience}}.",
        note: "Initial template",
        daysAgo: 14,
      },
      {
        body: [
          "You are a marketing copywriter at AACTIVATED. Write a launch email for {{product_name}}, a {{product_category}}, to {{target_audience}}.",
          "Goals:",
          "- Announce the launch and explain what it is in plain words.",
          "- Highlight the top {{key_benefits}} as education, not promises.",
          "- Use a {{tone}} tone.",
        ].join("\n"),
        note: "Added goals and tone",
        daysAgo: 13,
      },
      {
        body: [
          "You are a marketing copywriter at AACTIVATED. Write a launch email for {{product_name}}, a {{product_category}}, to {{target_audience}}.",
          "Goals:",
          "- Announce the launch and explain what it is in plain words.",
          "- Highlight the top {{key_benefits}} as education, not promises.",
          "- Use a {{tone}} tone. No health or medical claims.",
          "- Keep the email to about {{email_length}}.",
          "- Give 3 subject line options.",
          "- End with this call to action: {{call_to_action}}.",
        ].join("\n"),
        note: "Added length, subject lines and call to action",
        daysAgo: 13,
      },
    ],
  },
  {
    key: "marketing.ad_copy",
    name: "Marketing ad copy",
    description: "Short ad copy variations that pass the posting rules.",
    dept: "marketing",
    author: "maya",
    versions: [
      {
        body: "Write 3 short {{channel}} ad variations for {{offer}} aimed at {{audience}}. Educational, no claims, no countdown pressure.",
        note: "Initial template",
        daysAgo: 21,
      },
    ],
  },
  {
    key: "content.blog_outline",
    name: "Blog post outline",
    description: "A structured outline for an education blog post.",
    dept: "marketing",
    author: "devon",
    versions: [
      {
        body: "Outline a blog post titled {{title}} for {{audience}}. Give 5 sections with one-line notes each.",
        note: "Initial template",
        daysAgo: 18,
      },
      {
        body: "Outline a blog post titled {{title}} for {{audience}}. Give 5 sections with one-line notes each, a short intro and a closing that points to {{next_step}}. Cite only our own education program.",
        note: "Added intro, closing and sources rule",
        daysAgo: 5,
      },
    ],
  },
  {
    key: "social.post",
    name: "Social media post",
    description: "A single post with hashtags for one channel.",
    dept: "social",
    author: "maya",
    versions: [
      {
        body: "Write one {{channel}} post about {{topic}} in our brand voice: calm, factual, encouraging. Add up to {{hashtag_count}} hashtags. Branded stack names only.",
        note: "Initial template",
        daysAgo: 10,
      },
    ],
  },
  {
    key: "publishing.article",
    name: "Article draft",
    description: "A full education article for the blog or member library.",
    dept: "publishing",
    author: "devon",
    versions: [
      {
        body: [
          "Write a {{word_count}}-word article titled {{title}} for {{audience}}.",
          "- Open with why the topic matters to the reader.",
          "- Use short sections with clear headings and one practical takeaway each.",
          "- Educational and factual. No medical or health claims; branded stack names only.",
          "- End with {{call_to_action}}.",
        ].join("\n"),
        note: "Initial template",
        daysAgo: 4,
      },
    ],
  },
  {
    key: "publishing.ebook_outline",
    name: "E-book outline",
    description: "Chapter-by-chapter outline for a book or e-book.",
    dept: "publishing",
    author: "devon",
    versions: [
      {
        body: [
          "Outline an e-book titled {{title}} for {{audience}} in {{chapter_count}} chapters.",
          "- For each chapter: a working title, the reader's goal and 3 to 5 key points.",
          "- Add a short introduction and a closing chapter with next steps.",
          "- Note where a chart, checklist or worksheet would help.",
        ].join("\n"),
        note: "Initial template",
        daysAgo: 3,
      },
    ],
  },
  {
    key: "publishing.book_chapter",
    name: "Book chapter draft",
    description: "One full chapter for a book or e-book, from its outline.",
    dept: "publishing",
    author: "devon",
    versions: [
      {
        body: [
          "Write chapter {{chapter_number}} of {{book_title}}: {{chapter_title}}.",
          "Outline for this chapter: {{chapter_outline}}",
          "- About {{word_count}} words in a warm, clear, educational voice.",
          "- No medical or health claims; branded stack names only.",
          "- End with a short summary and a bridge to the next chapter.",
        ].join("\n"),
        note: "Initial template",
        daysAgo: 2,
      },
    ],
  },
  {
    key: "leads.consented_followup",
    name: "Follow-up for consented leads",
    description: "A friendly reply to someone who opted in. Never for cold outreach.",
    dept: "sales",
    author: "devon",
    versions: [
      {
        body: "Write a short follow-up to {{first_name}}, who opted in via {{consent_source}} and asked about {{interest}}. Answer helpfully, invite questions and offer {{next_step}}. Do not send to anyone who has not opted in.",
        note: "Initial template",
        daysAgo: 7,
      },
    ],
  },
];
