import { describe, expect, it } from "vitest";
import { MockModelAdapter } from "@/lib/ai/mock";
import { costUsd } from "@/lib/ai/pricing";
import { parseEnv } from "@/lib/env";
import { NAV_GROUPS } from "@/lib/navigation";
import { can, PERMISSIONS } from "@/server/authz/permissions";
import { overallStatus } from "@/server/health/health";

describe("environment", () => {
  const base = { DATABASE_URL: "postgresql://x" };

  it("defaults to the mock AI provider and mock integrations", () => {
    const env = parseEnv(base);
    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.INTEGRATION_GOHIGHLEVEL).toBe("mock");
    expect(env.DEMO_LOGIN_ENABLED).toBe(false);
  });

  it("refuses demo login in production", () => {
    expect(() => parseEnv({ ...base, APP_ENV: "production", DEMO_LOGIN_ENABLED: "true" })).toThrow(
      /Demo login/,
    );
  });

  it("allows demo login in development", () => {
    expect(
      parseEnv({ ...base, APP_ENV: "development", DEMO_LOGIN_ENABLED: "true" }).DEMO_LOGIN_ENABLED,
    ).toBe(true);
  });
});

describe("AI pricing and mock adapter", () => {
  it("prices Opus 5.5 and Sonnet 5.5 per million tokens", () => {
    expect(costUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBeCloseTo(24);
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 0)).toBeCloseTo(2);
  });

  it("over-estimates unknown models instead of under-reporting spend", () => {
    expect(costUsd("some-future-model", 1_000_000, 0)).toBeGreaterThanOrEqual(
      costUsd("claude-opus-5-5", 1_000_000, 0),
    );
  });

  it("returns deterministic mock output with token counts", async () => {
    const adapter = new MockModelAdapter();
    const request = {
      tier: "brain" as const,
      system: "Snapshot:\n- Agents active: 9",
      messages: [{ role: "user" as const, content: "Status?" }],
    };
    const a = await adapter.complete(request);
    const b = await adapter.complete(request);
    expect(a).toEqual(b);
    expect(a.text).toContain("Agents active: 9");
    expect(a.inputTokens).toBeGreaterThan(0);
    expect(a.refused).toBe(false);
  });
});

describe("navigation", () => {
  const items = NAV_GROUPS.flatMap((g) => g.items);

  it("only references real permissions", () => {
    for (const item of items)
      for (const p of item.permissions) expect(PERMISSIONS[p]).toBeDefined();
  });

  it("shows a free rep only their own areas", () => {
    const visible = items
      .filter((i) => i.permissions.some((p) => can("FREE_REP", p)))
      .map((i) => i.href);
    expect(visible.sort()).toEqual(["/back-office", "/knowledge", "/my-team", "/settings"]);
  });
});

describe("overallStatus", () => {
  it("is DOWN only when a critical component is down", () => {
    expect(
      overallStatus([
        { status: "DOWN", critical: true },
        { status: "OPERATIONAL", critical: false },
      ]),
    ).toBe("DOWN");
  });

  it("degrades (never goes down) when an integration fails", () => {
    expect(
      overallStatus([
        { status: "OPERATIONAL", critical: true },
        { status: "DOWN", critical: false },
      ]),
    ).toBe("DEGRADED");
  });

  it("is operational when everything is", () => {
    expect(overallStatus([{ status: "OPERATIONAL", critical: true }])).toBe("OPERATIONAL");
  });
});
