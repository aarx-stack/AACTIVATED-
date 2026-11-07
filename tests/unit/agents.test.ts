import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { toStructuredOutputSchema } from "@/lib/ai/schema";
import { MockModelAdapter } from "@/lib/ai/mock";
import { buildSystemPrompt, hasTool, readAgentConfig } from "@/server/agents/config";
import { brainPlanSkill, contentDraftSkill, opsDelegateSkill } from "@/server/agents/skills";
import { canonicalJson, hashPayload } from "@/server/approvals/payload";
import { approvalVisibilityWhere } from "@/server/queries/approvals";

describe("payload fingerprint", () => {
  it("is independent of key order", () => {
    expect(hashPayload({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      hashPayload({ b: { d: [1, 2], c: 2 }, a: 1 }),
    );
  });

  it("changes when any value changes", () => {
    expect(hashPayload({ caption: "a" })).not.toBe(hashPayload({ caption: "b" }));
    expect(hashPayload({ tags: [1, 2] })).not.toBe(hashPayload({ tags: [2, 1] }));
  });

  it("drops undefined keys like JSON does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("structured output schema", () => {
  it("removes constraints the API rejects and closes every object", () => {
    const schema = toStructuredOutputSchema(
      z.object({
        name: z.string().min(2).max(5),
        items: z.array(z.object({ n: z.number().min(1) })).min(1),
      }),
    );
    const text = JSON.stringify(schema);
    for (const key of ["minLength", "maxLength", "minimum", "minItems", "$schema"])
      expect(text).not.toContain(key);
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).toContain('"additionalProperties":false');
  });
});

describe("skills", () => {
  const plan = brainPlanSkill.mock({
    brief: "Write a post about the Recovery Stack routine.",
    channel: "INSTAGRAM",
    requestedBy: "Maya",
  });
  const assignment = opsDelegateSkill.mock({ brief: "x", channel: "INSTAGRAM", plan });
  const draft = contentDraftSkill.mock({
    brief: "Write a post about the Recovery Stack routine.",
    channel: "INSTAGRAM",
    assignment,
    brandSources: ["Brand voice guide v3", "Content & posting rules"],
  });

  it("mock outputs satisfy each skill's schema", () => {
    expect(brainPlanSkill.output.parse(plan)).toEqual(plan);
    expect(opsDelegateSkill.output.parse(assignment)).toEqual(assignment);
    expect(contentDraftSkill.output.parse(draft)).toEqual(draft);
  });

  it("drafts deterministically, cites sources and uses branded stack hashtags", () => {
    const again = contentDraftSkill.mock({
      brief: "Write a post about the Recovery Stack routine.",
      channel: "INSTAGRAM",
      assignment,
      brandSources: ["Brand voice guide v3", "Content & posting rules"],
    });
    expect(again).toEqual(draft);
    expect(draft.hashtags).toContain("#RecoveryStack");
    expect(draft.sources.map((s) => s.title)).toContain("Brand voice guide v3");
    expect(draft.caption).not.toMatch(/^write/i);
  });

  it("the mock adapter returns the skill's mock output as JSON", async () => {
    const result = await new MockModelAdapter().complete({
      tier: "agent",
      system: "",
      messages: [],
      mockOutput: plan,
    });
    expect(JSON.parse(result.text)).toEqual(plan);
  });

  it("raises priority for urgent briefs", () => {
    expect(
      brainPlanSkill.mock({
        brief: "Urgent: post today about the event",
        channel: "TIKTOK",
        requestedBy: "x",
      }).priority,
    ).toBe("HIGH");
  });
});

describe("agent config", () => {
  it("builds a system prompt from ROLE, CONTEXT and DAILY ROUTINE plus company rules", () => {
    const prompt = buildSystemPrompt({
      name: "Quill",
      title: "Content Specialist",
      config: {
        role: "Write posts.",
        context: "Brand voice.",
        dailyRoutine: "Draft daily.",
        toolsAllowed: ["content.draft"],
      },
    });
    expect(prompt).toContain("## ROLE\nWrite posts.");
    expect(prompt).toContain("## DAILY ROUTINE\nDraft daily.");
    expect(prompt).toMatch(/Never make medical or health claims/);
    expect(prompt).toMatch(/Approval Queue/);
  });

  it("checks tool permissions and tolerates bad config", () => {
    expect(
      hasTool(
        { role: "r", context: "c", dailyRoutine: "d", toolsAllowed: ["content.draft"] },
        "content.draft",
      ),
    ).toBe(true);
    expect(
      hasTool({ role: "r", context: "c", dailyRoutine: "d", toolsAllowed: [] }, "content.draft"),
    ).toBe(false);
    expect(readAgentConfig(null).toolsAllowed).toEqual([]);
  });
});

describe("approval visibility", () => {
  it("shows executives everything", () => {
    expect(approvalVisibilityWhere(Role.EXECUTIVE)).toEqual({});
  });

  it("hides legal and confidential-department requests from staff", () => {
    const where = approvalVisibilityWhere(Role.STAFF);
    expect(where.type).toEqual({ not: "LEGAL" });
    expect(JSON.stringify(where.OR)).toContain('"isConfidential":false');
  });
});
