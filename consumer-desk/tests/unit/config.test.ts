import { describe, expect, it } from "vitest";
import { demoLoginAllowed, readConfig, resolveMailPolicy } from "@/server/config";
import { CONNECTED_ENV } from "../support/fixtures";

const policy = (env: Record<string, string>) => resolveMailPolicy(readConfig(env));

describe("server-enforced mail policy", () => {
  it("defaults to demo data + mock mail with live disabled", () => {
    const c = readConfig({});
    expect(c.dataMode).toBe("demo");
    expect(c.mailMode).toBe("mock");
    expect(c.liveMailingEnabled).toBe(false);
    const p = resolveMailPolicy(c);
    expect(p.provider).toBe("mock");
    expect(p.mayCreateRealMail).toBe(false);
  });

  it("demo data can never use a real provider", () => {
    for (const MAIL_MODE of ["provider_test", "live"]) {
      const p = policy({ DATA_MODE: "demo", MAIL_MODE, LIVE_MAILING_ENABLED: "true" });
      expect(p.canSubmit).toBe(false);
      expect(p.provider).toBe("none");
      expect(p.indicator).toBe("MISCONFIGURED");
    }
  });

  it("live mode is blocked unless LIVE_MAILING_ENABLED=true", () => {
    expect(policy({ ...CONNECTED_ENV, MAIL_MODE: "live" }).canSubmit).toBe(false);
    expect(policy({ ...CONNECTED_ENV, MAIL_MODE: "live", LIVE_MAILING_ENABLED: "yes" }).canSubmit).toBe(false);
    const enabled = policy({ ...CONNECTED_ENV, MAIL_MODE: "live", LIVE_MAILING_ENABLED: "true" });
    expect(enabled.canSubmit).toBe(true);
    expect(enabled.mayCreateRealMail).toBe(true);
  });

  it("LIVE_MAILING_ENABLED alone never switches mock/test to live", () => {
    expect(policy({ ...CONNECTED_ENV, MAIL_MODE: "mock", LIVE_MAILING_ENABLED: "true" }).recordMode).toBe("mock");
    expect(policy({ ...CONNECTED_ENV, MAIL_MODE: "provider_test", LIVE_MAILING_ENABLED: "true" }).recordMode).toBe("provider_test");
  });

  it("fails closed on unknown values or missing connected configuration", () => {
    expect(policy({ MAIL_MODE: "production" }).canSubmit).toBe(false);
    expect(policy({ DATA_MODE: "postgres" }).canSubmit).toBe(false);
    expect(policy({ DATA_MODE: "supabase", MAIL_MODE: "mock" }).canSubmit).toBe(false);
  });

  it("provider test mode is treated as possibly creating real mail", () => {
    expect(policy({ ...CONNECTED_ENV, MAIL_MODE: "provider_test" }).mayCreateRealMail).toBe(true);
  });
});

describe("demo sign-in shortcut", () => {
  it("only works for demo data on loopback hosts", () => {
    const dev = readConfig({ DATA_MODE: "demo", NODE_ENV: "development" });
    expect(demoLoginAllowed(dev, "localhost:3000")).toBe(true);
    expect(demoLoginAllowed(dev, "127.0.0.1:3000")).toBe(true);
    expect(demoLoginAllowed(dev, "[::1]:3000")).toBe(true);
    expect(demoLoginAllowed(dev, "consumer-desk.example.com")).toBe(false);
    expect(demoLoginAllowed(dev, "localhost.evil.com")).toBe(false);
    expect(demoLoginAllowed(dev, null)).toBe(false);
    expect(demoLoginAllowed(readConfig({ ...CONNECTED_ENV, NODE_ENV: "development" }), "localhost")).toBe(false);
  });

  it("fails closed in production builds and on Vercel", () => {
    expect(demoLoginAllowed(readConfig({ DATA_MODE: "demo", NODE_ENV: "production" }), "localhost")).toBe(false);
    expect(demoLoginAllowed(readConfig({ DATA_MODE: "demo", NODE_ENV: "production", DEMO_ALLOW_PRODUCTION_BUILD: "true" }), "localhost")).toBe(true);
    expect(
      demoLoginAllowed(readConfig({ DATA_MODE: "demo", NODE_ENV: "production", DEMO_ALLOW_PRODUCTION_BUILD: "true", VERCEL: "1" }), "localhost"),
    ).toBe(false);
    expect(demoLoginAllowed(readConfig({ DATA_MODE: "demo", NODE_ENV: "development", VERCEL: "1" }), "localhost")).toBe(false);
  });
});
