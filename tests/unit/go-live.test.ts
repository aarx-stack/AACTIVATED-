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

describe("security hardening", () => {
  it("sign-in links always use the app's own address, whatever host the request claimed", async () => {
    const { pinToAppUrl } = await import("@/server/auth/email");
    expect(
      pinToAppUrl(
        "https://evil.example/api/auth/callback/nodemailer?token=abc&email=ceo%40x.test",
        "https://brain.aactivated.test",
      ),
    ).toBe(
      "https://brain.aactivated.test/api/auth/callback/nodemailer?token=abc&email=ceo%40x.test",
    );
  });

  it("rate limits use the address the proxy saw, never the client's own claim", async () => {
    const { clientAddressFrom } = await import("@/server/security/rate-limit");
    const h = (init: Record<string, string>) => new Headers(init);
    expect(clientAddressFrom(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientAddressFrom(h({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
    expect(clientAddressFrom(h({}))).toBe("unknown");
  });
});

describe("production safety checks", () => {
  const prod = {
    DATABASE_URL: "postgresql://x",
    APP_ENV: "production",
    APP_URL: "https://brain.example.test",
    AUTH_SECRET: "k".repeat(44),
    EMAIL_TRANSPORT: "smtp",
    EMAIL_SERVER: "smtp://mail.example.test:587",
  };
  const parse = (extra: Record<string, string | undefined>) => () =>
    getEnv({ ...prod, ...extra } as unknown as NodeJS.ProcessEnv);

  it("accepts a sound production configuration", () => {
    expect(parse({})).not.toThrow();
  });

  it("refuses demo login, a weak secret, console email and plain http", () => {
    expect(parse({ DEMO_LOGIN_ENABLED: "true" })).toThrow(/Demo login/);
    expect(parse({ AUTH_SECRET: "replace-me-with-a-long-random-string-xxxx" })).toThrow(
      /AUTH_SECRET/,
    );
    expect(parse({ AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
    expect(parse({ EMAIL_TRANSPORT: "console" })).toThrow(/smtp/);
    expect(parse({ APP_URL: "http://brain.example.test" })).toThrow(/https/);
  });

  it("a production server without APP_ENV refuses to start", () => {
    expect(() =>
      getEnv({
        DATABASE_URL: "postgresql://x",
        NODE_ENV: "production",
        DEMO_LOGIN_ENABLED: "true",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/set APP_ENV/);
  });
});

describe("email rendering", () => {
  it("escapes the body, keeps paragraphs and always adds the unsubscribe footer", async () => {
    const { renderEmail } = await import("@/server/email/campaigns");
    const { text, html } = renderEmail(
      "Hello <b>team</b>,\n\nSecond line & more",
      "https://brain.example.test/unsubscribe?t=abc",
    );
    expect(html).toContain("<p>Hello &lt;b&gt;team&lt;/b&gt;,</p><p>Second line &amp; more</p>");
    expect(html).toContain(
      '<a href="https://brain.example.test/unsubscribe?t=abc">Unsubscribe</a>',
    );
    expect(text).toMatch(/Unsubscribe: https:\/\/brain\.example\.test\/unsubscribe\?t=abc$/);
  });
});

describe("EPUB export", () => {
  it("is a valid EPUB zip: mimetype first and uncompressed, escaped XHTML, DRAFT until final", async () => {
    const { buildEpub, fileNameFor } = await import("@/server/publishing/epub");
    const book = {
      title: "Routines & <Habits>",
      subtitle: null,
      kind: "EBOOK" as const,
      audience: "members",
      author: "AACTIVATED RX",
      final: false,
      words: 10,
      updatedAt: new Date("2026-11-08T10:00:00Z"),
      sections: [{ id: "a", title: "One", body: "Hello & welcome.\n\nSecond paragraph." }],
    };
    const file = buildEpub(book, "pub1");
    expect(file.readUInt32LE(0)).toBe(0x04034b50);
    expect(file.readUInt16LE(8)).toBe(0); // stored
    expect(file.subarray(30, 38).toString()).toBe("mimetype");
    expect(file.subarray(38, 58).toString()).toBe("application/epub+zip");
    const text = file.toString("latin1");
    for (const name of [
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/part-1.xhtml",
    ]) {
      expect(text).toContain(name);
    }
    const { inflateRawSync } = await import("node:zlib");
    // Find part-1 in the archive and inflate it.
    const at = text.lastIndexOf("OEBPS/part-1.xhtml", text.indexOf("PK\x01\x02"));
    const header = at - 30;
    const size = file.readUInt32LE(header + 18);
    const nameLen = file.readUInt16LE(header + 26);
    const xhtml = inflateRawSync(file.subarray(at + nameLen, at + nameLen + size)).toString();
    expect(xhtml).toContain("<p>Hello &amp; welcome.</p>");
    expect(xhtml).toContain("DRAFT: not approved");
    expect(buildEpub({ ...book, final: true }, "pub1").toString("latin1")).not.toContain("DRAFT");
    expect(fileNameFor("Routines & <Habits>!", "epub")).toBe("routines-habits.epub");
  });
});

describe("site password (staging copies)", () => {
  it("accepts only the right password, with any user name; health and unsubscribe stay public", async () => {
    const { hasSitePassword, isPublicPath } = await import("@/server/security/site-password");
    const basic = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`;
    expect(hasSitePassword(basic("team:open sesame"), "open sesame")).toBe(true);
    expect(hasSitePassword(basic("anyone:open sesame"), "open sesame")).toBe(true);
    expect(hasSitePassword(basic("team:wrong"), "open sesame")).toBe(false);
    expect(hasSitePassword(basic("no-colon"), "no-colon")).toBe(false);
    expect(hasSitePassword(null, "open sesame")).toBe(false);
    expect(hasSitePassword("Bearer x", "open sesame")).toBe(false);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/unsubscribe")).toBe(true);
    expect(isPublicPath("/command-center")).toBe(false);
  });

  it("uses the host's public address when APP_URL is not set", () => {
    const env = getEnv({
      DATABASE_URL: "postgresql://x",
      RENDER_EXTERNAL_URL: "https://aactivated-ai-brain.onrender.com",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.APP_URL).toBe("https://aactivated-ai-brain.onrender.com");
  });
});
