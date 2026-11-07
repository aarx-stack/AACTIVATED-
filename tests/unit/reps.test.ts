import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { coachPlanSkill, followUpSkill, rewriteSkill } from "@/server/agents/skills";
import { canAccessContent, splitBody } from "@/server/content/studio";
import { contentVisibilityWhere, monthKey, parseMonth } from "@/server/queries/content";
import { commissionProgress, COMMISSION_PLAN } from "@/server/reps/commission-plan";
import { POD_ROLES } from "@/server/reps/pods";
import { startOfWeek } from "@/server/reps/service";

describe("commission plan progress", () => {
  it("starts everyone at the first rank", () => {
    const p = commissionProgress({ monthEarningsUsd: 0, teamSize: 0, presenterStatus: "NONE" });
    expect(p.current.name).toBe(COMMISSION_PLAN[0]!.name);
    expect(p.next?.name).toBe("Builder");
    expect(p.overall).toBe(0);
  });

  it("climbs ranks only when every requirement is met", () => {
    expect(
      commissionProgress({ monthEarningsUsd: 300, teamSize: 3, presenterStatus: "NONE" }).current
        .name,
    ).toBe("Builder");
    // Earnings and team are enough for Presenter, but certification is missing.
    const p = commissionProgress({
      monthEarningsUsd: 900,
      teamSize: 6,
      presenterStatus: "CANDIDATE",
    });
    expect(p.current.name).toBe("Builder");
    expect(p.requirements.find((r) => r.label.includes("certification"))?.met).toBe(false);
  });

  it("caps each requirement's contribution at 100%", () => {
    const p = commissionProgress({
      monthEarningsUsd: 10_000,
      teamSize: 0,
      presenterStatus: "NONE",
    });
    expect(p.overall).toBeCloseTo(0.5);
  });

  it("reports the top rank with no next rank", () => {
    const p = commissionProgress({
      monthEarningsUsd: 5000,
      teamSize: 20,
      presenterStatus: "PRESENTER",
    });
    expect(p.current.name).toBe("Leader");
    expect(p.next).toBeNull();
    expect(p.overall).toBe(1);
  });
});

describe("pod roles", () => {
  it("gives premium reps four agents and free reps the coach", () => {
    expect(POD_ROLES.PREMIUM_REP).toHaveLength(4);
    expect(POD_ROLES.FREE_REP).toEqual(["BUSINESS_COACH"]);
    expect(POD_ROLES.STAFF).toEqual([]);
  });
});

describe("content access", () => {
  const repA = { id: "a", role: Role.PREMIUM_REP };
  it("limits reps to their own content", () => {
    expect(canAccessContent(repA, { repId: "a" })).toBe(true);
    expect(canAccessContent(repA, { repId: "b" })).toBe(false);
    expect(canAccessContent(repA, { repId: null })).toBe(false);
    expect(canAccessContent({ id: "f", role: Role.FREE_REP }, { repId: "f" })).toBe(false);
  });

  it("lets executives and staff see everything", () => {
    expect(canAccessContent({ id: "s", role: Role.STAFF }, { repId: "a" })).toBe(true);
    expect(contentVisibilityWhere({ id: "s", role: Role.EXECUTIVE })).toEqual({});
    expect(contentVisibilityWhere(repA)).toEqual({ repId: "a" });
  });
});

describe("helpers", () => {
  it("splits a trailing hashtag line from the caption", () => {
    expect(splitBody("Hello world.\n\n#One #Two")).toEqual({
      caption: "Hello world.",
      hashtags: ["#One", "#Two"],
    });
    expect(splitBody("No tags here #inline mention")).toEqual({
      caption: "No tags here #inline mention",
      hashtags: [],
    });
  });

  it("finds Monday of the current week", () => {
    const sunday = new Date(2026, 10, 8, 15); // Sun 8 Nov 2026
    expect(startOfWeek(sunday).getDate()).toBe(2);
    const monday = new Date(2026, 10, 2, 9);
    expect(startOfWeek(monday).getDate()).toBe(2);
  });

  it("parses calendar months safely", () => {
    expect(monthKey(parseMonth("2026-03"))).toBe("2026-03");
    const now = new Date(2026, 10, 7);
    expect(monthKey(parseMonth("bad", now))).toBe("2026-11");
    expect(monthKey(parseMonth("2026-13", now))).toBe("2026-11");
  });
});

describe("rep skills", () => {
  it("coach plans cover five weekdays and free plans use only the coach", () => {
    const premium = coachPlanSkill.mock({
      repName: "Jordan Ellis",
      plan: "PREMIUM",
      presenterStatus: "NONE",
      monthEarningsUsd: 0,
      newContacts: 2,
    });
    const free = coachPlanSkill.mock({
      repName: "Sam Carter",
      plan: "FREE",
      presenterStatus: "NONE",
      monthEarningsUsd: 0,
      newContacts: 0,
    });
    expect(coachPlanSkill.output.parse(premium).days).toHaveLength(5);
    expect(free.days.flatMap((d) => d.actions).every((a) => a.owner === "BUSINESS_COACH")).toBe(
      true,
    );
  });

  it("follow-ups reference the consent and include an opt-out", () => {
    const out = followUpSkill.mock({
      repName: "Jordan Ellis",
      contact: {
        name: "Alex Morgan",
        consentEvidence: "Requested the guide.",
        channel: "EMAIL",
        status: "NEW",
      },
    });
    expect(followUpSkill.output.parse(out).message).toMatch(/STOP/);
    expect(out.message).toContain("requested the guide");
    expect(out.subject).toBeDefined();
  });

  it("caption rewrites return valid variants", () => {
    const out = rewriteSkill.mock({
      title: "T",
      caption: "First sentence here. Second one. Third one.",
      channel: "INSTAGRAM",
    });
    expect(rewriteSkill.output.parse(out).variants.length).toBeGreaterThanOrEqual(2);
  });
});
