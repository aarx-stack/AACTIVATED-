/**
 * Agent skills: one model call each, with a typed output.
 *
 * Every skill declares:
 *  - its output schema (sent to Claude as a structured-output JSON schema and
 *    used to validate the reply),
 *  - the user prompt it sends,
 *  - a deterministic `mock` answer used when AI_PROVIDER=mock, so the whole
 *    workflow runs offline, for free, and identically in tests.
 */
import { z } from "zod";
import type { ContentChannel } from "@/generated/prisma/enums";
import type { ModelTier } from "@/lib/ai/types";

export interface Skill<I, O> {
  name: string;
  tier: ModelTier;
  /** Tool the agent must be allowed to use to run this skill. */
  requiresTool: string;
  output: z.ZodType<O>;
  prompt(input: I): string;
  mock(input: I): O;
}

function defineSkill<I, O>(skill: Skill<I, O>) {
  return skill;
}

export const CHANNEL_LABEL: Record<ContentChannel, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  EMAIL: "Email",
};

/** Small stable hash for deterministic mock choices. */
function pickIndex(text: string, n: number) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

function firstSentence(text: string, max = 90) {
  const s = text.trim().split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ---------------------------------------------------------------- Brain plan --

export interface PlanInput {
  brief: string;
  channel: ContentChannel;
  requestedBy: string;
}

export const planOutput = z.object({
  objective: z.string().min(5).max(300),
  steps: z.array(z.string().min(3).max(200)).min(2).max(6),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  delegateTo: z.literal("Operations Manager"),
});
export type PlanOutput = z.infer<typeof planOutput>;

export const brainPlanSkill = defineSkill<PlanInput, PlanOutput>({
  name: "brain.plan",
  tier: "brain",
  requiresTool: "tasks.create",
  output: planOutput,
  prompt: (i) =>
    [
      `${i.requestedBy} asked for new ${CHANNEL_LABEL[i.channel]} content.`,
      `Brief: """${i.brief}"""`,
      "Plan the work: state the objective, list 2-6 steps, set a priority, and delegate to the Operations Manager.",
      "Remember: the result must pass the compliance check and wait for human approval before anything is published.",
    ].join("\n"),
  mock: (i) => ({
    objective: `Publish-ready ${CHANNEL_LABEL[i.channel]} content: ${firstSentence(i.brief, 120)}`,
    steps: [
      "Operations Manager turns the brief into an assignment for the Content Specialist",
      `Content Specialist drafts the ${CHANNEL_LABEL[i.channel]} post in the brand voice`,
      "Automated compliance check against the current content rules",
      "Submit to the Approval Queue with reasoning and sources",
    ],
    priority: /urgent|today|asap/i.test(i.brief) ? "HIGH" : "MEDIUM",
    delegateTo: "Operations Manager",
  }),
});

// ------------------------------------------------------- Operations delegate --

export interface DelegateInput {
  brief: string;
  channel: ContentChannel;
  plan: PlanOutput;
}

export const delegateOutput = z.object({
  assignment: z.string().min(10).max(800),
  checklist: z.array(z.string().min(3).max(160)).min(2).max(6),
  dueInHours: z.number().int().min(1).max(168),
  assignee: z.string().min(2).max(60),
});
export type DelegateOutput = z.infer<typeof delegateOutput>;

export const opsDelegateSkill = defineSkill<DelegateInput, DelegateOutput>({
  name: "operations.delegate",
  tier: "agent",
  requiresTool: "handoff.create",
  output: delegateOutput,
  prompt: (i) =>
    [
      "The Brain delegated this plan to you:",
      JSON.stringify(i.plan, null, 2),
      `Original brief: """${i.brief}"""`,
      `Write a clear assignment for the Content Specialist for ${CHANNEL_LABEL[i.channel]}, a short checklist and a due time.`,
    ].join("\n"),
  mock: (i) => ({
    assignment: `Draft one ${CHANNEL_LABEL[i.channel]} post. Topic: ${firstSentence(i.brief, 160)} Keep it educational, use branded stack names only, and end with a question for the community.`,
    checklist: [
      "Open with a question hook (current best template)",
      "Education only: no outcome or health claims",
      "Branded stack names, never specific peptide names",
      `Fit ${CHANNEL_LABEL[i.channel]} length and format`,
    ],
    dueInHours: i.plan.priority === "HIGH" ? 4 : 24,
    assignee: "Content Specialist",
  }),
});

// ------------------------------------------------------------- Content draft --

export interface DraftInput {
  brief: string;
  channel: ContentChannel;
  assignment: DelegateOutput;
  brandSources: string[];
}

export const draftOutput = z.object({
  title: z.string().min(3).max(120),
  caption: z.string().min(10).max(2200),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).max(10),
  reasoning: z.string().min(20).max(1200),
  sources: z
    .array(z.object({ title: z.string().min(2).max(160), note: z.string().max(300).optional() }))
    .min(1)
    .max(6),
});
export type DraftOutput = z.infer<typeof draftOutput>;

const HOOKS = [
  "Recovery is a routine, not a moment.",
  "What does your recovery routine look like this week?",
  "Small habits, repeated daily, add up.",
  "Here is a question our community asks a lot.",
];

export const contentDraftSkill = defineSkill<DraftInput, DraftOutput>({
  name: "content.draft",
  tier: "agent",
  requiresTool: "content.draft",
  output: draftOutput,
  prompt: (i) =>
    [
      "Assignment from the Operations Manager:",
      JSON.stringify(i.assignment, null, 2),
      `Original brief: """${i.brief}"""`,
      `Reference material you may cite: ${i.brandSources.join("; ")}.`,
      `Write the ${CHANNEL_LABEL[i.channel]} post: title, caption, up to 6 hashtags, your reasoning for a human reviewer, and the sources you relied on.`,
    ].join("\n"),
  mock: (i) => {
    const hook = HOOKS[pickIndex(i.brief, HOOKS.length)]!;
    const topic = firstSentence(i.brief, 220).replace(
      /^(please\s+)?(write|create|draft|make)\s+(an?\s+)?/i,
      "",
    );
    const stack = i.brief.match(/\b([A-Z][a-z]+ Stack)\b/)?.[1];
    return {
      title: `${CHANNEL_LABEL[i.channel]}: ${firstSentence(topic, 70).replace(/[.!?…]$/, "")}`,
      caption: [
        hook,
        "",
        topic.charAt(0).toUpperCase() + topic.slice(1),
        "",
        "Our community focuses on education, consistency and simple daily routines.",
        "Which habit are you building this week? Tell us below.",
      ].join("\n"),
      hashtags: [
        "#AACTIVATED",
        "#Education",
        ...(stack ? [`#${stack.replace(/\s/g, "")}`] : ["#Routine"]),
      ],
      reasoning: `Drafted for ${CHANNEL_LABEL[i.channel]} from the Operations Manager's assignment, keeping the requested topic. It opens with a question-style hook (the current best template) and closes with an invitation to the community. I aimed for education rather than outcomes; the automated compliance check verifies that next and anything it flags is shown to the reviewer.`,
      sources: [
        { title: "Request brief", note: firstSentence(i.brief, 120) },
        ...i.brandSources.slice(0, 2).map((title) => ({ title })),
      ],
    };
  },
});

// ----------------------------------------------------- Business Coach: plan --

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export const POD_OWNERS = [
  "BUSINESS_COACH",
  "CONTENT_CREATOR",
  "SOCIAL_MEDIA_MANAGER",
  "LEAD_FOLLOWUP",
] as const;

export interface CoachInput {
  repName: string;
  plan: "PREMIUM" | "FREE";
  presenterStatus: string;
  monthEarningsUsd: number;
  newContacts: number;
  goal?: string;
}

export const coachPlanOutput = z.object({
  focus: z.string().min(5).max(200),
  days: z
    .array(
      z.object({
        day: z.enum(WEEKDAYS),
        actions: z
          .array(z.object({ title: z.string().min(3).max(120), owner: z.enum(POD_OWNERS) }))
          .min(1)
          .max(3),
      }),
    )
    .length(5),
  encouragement: z.string().min(5).max(300),
});
export type CoachPlanOutput = z.infer<typeof coachPlanOutput>;

export const coachPlanSkill = defineSkill<CoachInput, CoachPlanOutput>({
  name: "coach.weekly_plan",
  tier: "agent",
  requiresTool: "report.write",
  output: coachPlanOutput,
  prompt: (i) =>
    [
      `Plan ${i.repName}'s week (${i.plan === "PREMIUM" ? "Premium: full AI team" : "Free: coaching only"}).`,
      `Presenter status: ${i.presenterStatus}. Earnings this month: $${i.monthEarningsUsd.toFixed(2)}. New consented contacts: ${i.newContacts}.`,
      i.goal ? `Their goal this week: """${i.goal}"""` : "",
      "Give a one-line focus, 1-3 actions for each weekday with an owner from the pod, and a short encouragement.",
      i.plan === "FREE"
        ? "Free reps only have the Business Coach: every owner must be BUSINESS_COACH."
        : "",
      "Never promise income. Lead generation is consented inbound contacts only.",
    ]
      .filter(Boolean)
      .join("\n"),
  mock: (i) => {
    const premium = i.plan === "PREMIUM";
    const own = (title: string, owner: (typeof POD_OWNERS)[number]) => ({
      title,
      owner: premium ? owner : ("BUSINESS_COACH" as const),
    });
    return {
      focus: i.goal
        ? `This week: ${i.goal.slice(0, 120)}`
        : i.newContacts > 0
          ? "Follow up with new consented contacts and keep posting consistently."
          : "Show up consistently: one educational post and one learning block a day.",
      days: [
        {
          day: "Monday",
          actions: [
            own("Review the weekly plan and set one goal", "BUSINESS_COACH"),
            own("Draft an educational post for the week", "CONTENT_CREATOR"),
          ],
        },
        {
          day: "Tuesday",
          actions: [
            own("Reply to new consented contacts", "LEAD_FOLLOWUP"),
            own("Complete one training module", "BUSINESS_COACH"),
          ],
        },
        {
          day: "Wednesday",
          actions: [
            own("Schedule approved posts for the rest of the week", "SOCIAL_MEDIA_MANAGER"),
          ],
        },
        {
          day: "Thursday",
          actions: [
            own("Check in with contacts who asked questions", "LEAD_FOLLOWUP"),
            own("Share a community story (education only)", "CONTENT_CREATOR"),
          ],
        },
        {
          day: "Friday",
          actions: [own("Weekly reflection: what worked, what to change", "BUSINESS_COACH")],
        },
      ],
      encouragement: `Small, consistent steps compound, ${i.repName.split(" ")[0]}. Focus on helping people learn.`,
    };
  },
});

// ----------------------------------------------------- Lead follow-up draft --

export interface FollowUpInput {
  repName: string;
  contact: { name: string; consentEvidence: string; channel: ContentChannel; status: string };
  note?: string;
}

export const followUpOutput = z.object({
  subject: z.string().max(120).optional(),
  message: z.string().min(20).max(1200),
  reasoning: z.string().min(20).max(800),
  sources: z
    .array(z.object({ title: z.string().min(2).max(160), note: z.string().max(300).optional() }))
    .min(1)
    .max(4),
});
export type FollowUpOutput = z.infer<typeof followUpOutput>;

export const followUpSkill = defineSkill<FollowUpInput, FollowUpOutput>({
  name: "leads.follow_up",
  tier: "agent",
  requiresTool: "ghl.contacts.read",
  output: followUpOutput,
  prompt: (i) =>
    [
      `Draft a follow-up from ${i.repName} to ${i.contact.name} via ${CHANNEL_LABEL[i.contact.channel]}.`,
      `They opted in: ${i.contact.consentEvidence}. Current status: ${i.contact.status}.`,
      i.note ? `Rep's note: """${i.note}"""` : "",
      "Be warm and brief, offer help, no medical claims, no pressure, and include a clear way to opt out.",
    ]
      .filter(Boolean)
      .join("\n"),
  mock: (i) => {
    const first = i.contact.name.split(" ")[0] ?? i.contact.name;
    const repFirst = i.repName.split(" ")[0] ?? i.repName;
    return {
      subject: i.contact.channel === "EMAIL" ? `Following up, ${first}` : undefined,
      message: [
        `Hi ${first}, thanks for reaching out (${i.contact.consentEvidence.replace(/\.$/, "").toLowerCase()}).`,
        i.note
          ? `You mentioned: ${i.note}`
          : "I'm happy to share our educational resources and answer any questions.",
        "Would a short call this week be helpful?",
        repFirst,
        "",
        "Reply STOP and I won't message you again.",
      ].join("\n"),
      reasoning: `${first} opted in with a recorded consent (${i.contact.consentEvidence}). This is a single, helpful follow-up with an opt-out, sent only after approval.`,
      sources: [
        { title: "Consent record", note: i.contact.consentEvidence },
        { title: "Lead generation policy" },
      ],
    };
  },
});

// ------------------------------------------------------------ Caption rewrite --

export interface RewriteInput {
  title: string;
  caption: string;
  channel: ContentChannel;
  instruction?: string;
}

export const rewriteOutput = z.object({
  variants: z
    .array(z.object({ label: z.string().min(2).max(40), caption: z.string().min(10).max(2200) }))
    .min(2)
    .max(3),
});
export type RewriteOutput = z.infer<typeof rewriteOutput>;

export const rewriteSkill = defineSkill<RewriteInput, RewriteOutput>({
  name: "content.rewrite",
  tier: "agent",
  requiresTool: "content.draft",
  output: rewriteOutput,
  prompt: (i) =>
    [
      `Suggest 2-3 alternative ${CHANNEL_LABEL[i.channel]} captions for "${i.title}".`,
      `Current caption: """${i.caption}"""`,
      i.instruction ? `Direction: """${i.instruction}"""` : "",
      "Keep it educational, no health claims, branded stack names only.",
    ]
      .filter(Boolean)
      .join("\n"),
  mock: (i) => {
    const sentences = i.caption.split(/(?<=[.!?])\s+/).filter(Boolean);
    const short = sentences.slice(0, 2).join(" ");
    return {
      variants: [
        { label: "Shorter", caption: short.length >= 10 ? short : i.caption },
        {
          label: "Question hook",
          caption: `What does consistency look like for you?\n\n${i.caption}`,
        },
        {
          label: i.instruction ? "Your direction" : "Warmer",
          caption: i.instruction
            ? `${i.caption}\n\n${i.instruction.slice(0, 160)}`
            : `${i.caption}\n\nWe're glad you're here. Learn with us.`,
        },
      ],
    };
  },
});

export const SKILLS = [
  brainPlanSkill,
  opsDelegateSkill,
  contentDraftSkill,
  coachPlanSkill,
  followUpSkill,
  rewriteSkill,
] as const;
