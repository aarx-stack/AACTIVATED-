import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";
import { taskWorkOutput, taskWorkSkill } from "@/server/agents/skills";
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
  SecretKeyError,
} from "@/server/crypto/secrets";
import { missingCredentials } from "@/server/integrations";
import type { FetchLike } from "@/server/integrations/live/http";
import {
  buildAuthorizeUrl,
  exchangeCode,
  oauthMissing,
  QB_OAUTH,
  refreshTokens,
} from "@/server/integrations/quickbooks-connection";
import { limitKey } from "@/server/security/rate-limit";

const KEY_B64 = randomBytes(32).toString("base64");
const base = getEnv({ DATABASE_URL: "postgresql://x" } as unknown as NodeJS.ProcessEnv);
const oauthEnv = {
  ...base,
  APP_URL: "https://brain.example.test",
  QUICKBOOKS_CLIENT_ID: "client-id",
  QUICKBOOKS_CLIENT_SECRET: "client-secret",
  TOKEN_ENCRYPTION_KEY: KEY_B64,
};

describe("encryption at rest", () => {
  const key = parseEncryptionKey(KEY_B64);

  it("round-trips, and never produces the same ciphertext twice", () => {
    const a = encryptSecret("refresh-token-value", key);
    const b = encryptSecret("refresh-token-value", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token-value");
    expect(decryptSecret(a, key)).toBe("refresh-token-value");
  });

  it("detects tampering and a wrong key", () => {
    const sealed = encryptSecret("secret", key);
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    parts[3] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow(SecretKeyError);
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow(/could not be decrypted/);
    expect(() => decryptSecret("garbage", key)).toThrow(/recognised format/);
  });

  it("refuses a missing or short key", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/not set/);
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(
      /32 random bytes/,
    );
  });

  it("environment validation requires a key once the QuickBooks app is configured", () => {
    expect(() =>
      getEnv({
        DATABASE_URL: "postgresql://x",
        QUICKBOOKS_CLIENT_ID: "id",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});

describe("Connect QuickBooks (OAuth)", () => {
  it("sends the admin to Intuit with the right client, scope, redirect and state", () => {
    const url = new URL(buildAuthorizeUrl("state-123", oauthEnv));
    expect(`${url.origin}${url.pathname}`).toBe(QB_OAUTH.authorizeUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting",
      redirect_uri: "https://brain.example.test/api/integrations/quickbooks/callback",
      state: "state-123",
    });
  });

  it("exchanges the code with Basic auth and records when each token expires", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 3600,
          x_refresh_token_expires_in: 8_726_400,
        }),
      );
    };
    const before = Date.now();
    const tokens = await exchangeCode("the-code", oauthEnv, fetchImpl);
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.accessExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(tokens.refreshExpiresAt.getTime()).toBeGreaterThan(before + 100 * 86_400_000);

    const { url, init } = calls[0]!;
    expect(url).toBe(QB_OAUTH.tokenUrl);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "https://brain.example.test/api/integrations/quickbooks/callback",
    });
  });

  it("refresh sends the refresh token; an incomplete answer is an error", async () => {
    let body = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ access_token: "only-access" }));
    };
    await expect(refreshTokens("rt-old", oauthEnv, fetchImpl)).rejects.toThrow(/incomplete/);
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt-old",
    });
  });

  it("live QuickBooks needs the OAuth app or a fixed sandbox token", () => {
    const live = { ...base, INTEGRATION_QUICKBOOKS: "live" as const };
    expect(missingCredentials("QUICKBOOKS", live)).toEqual(oauthMissing(live));
    expect(missingCredentials("QUICKBOOKS", { ...live, ...oauthEnv })).toEqual([]);
    expect(
      missingCredentials("QUICKBOOKS", {
        ...live,
        QUICKBOOKS_REALM_ID: "1",
        QUICKBOOKS_ACCESS_TOKEN: "t",
      }),
    ).toEqual([]);
  });
});

describe("rate limit keys", () => {
  it("never store the email address or IP in plain text", () => {
    const key = limitKey("signin-email", "Guy@Example.test ");
    expect(key).toMatch(/^signin-email:[0-9a-f]{32}$/);
    expect(key).not.toContain("guy");
    expect(key).toBe(limitKey("signin-email", "guy@example.test"));
  });
});

describe("prompt task skill", () => {
  it("mock output is valid and reminds people about the Approval Queue", () => {
    const out = taskWorkSkill.mock({
      title: "Weekly recap (prompt v2)",
      prompt: "Write a weekly recap for staff.\n- Cover wins\n- Cover blockers",
      agentTitle: "Operations Manager",
    });
    expect(taskWorkOutput.safeParse(out).success).toBe(true);
    expect(out.deliverable).toContain("Cover wins");
    expect(out.nextSteps.join(" ")).toContain("Approval Queue");
  });
});
