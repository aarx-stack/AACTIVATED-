import { beforeAll, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "@worker/index";
import { fakeD1, openTestDb, seedAffiliate } from "./helpers/sqlite";
import type { SqlDb } from "@worker/lib/db";

const TEAM = "test-team.cloudflareaccess.com";
const AUD = "test-aud-tag";

/* — mint real RS256 JWTs against a mocked Access certs endpoint — */

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

const b64url = (bytes: Uint8Array | string): string => {
  const bin = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return Buffer.from(bin).toString("base64url");
};

async function mintToken(claims: Record<string, unknown>, tamper = false): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      aud: [AUD],
      iss: `https://${TEAM}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
  if (tamper) sig[10]! ^= 0xff;
  return `${header}.${payload}.${b64url(sig)}`;
}

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicJwk = {
    ...((await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey),
    kid: "test-key",
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected outbound fetch in test: ${url}`);
    }),
  );
});

function makeEnv(db: ReturnType<typeof openTestDb>, overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeD1(db.raw),
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ...overrides,
  };
}

const api = (env: Env, path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Cf-Access-Jwt-Assertion", init.token);
  return worker.fetch(new Request(`https://app.example${path}`, { ...init, headers }), env);
};

async function provision(db: SqlDb, subject: string, role: "affiliate" | "admin", affiliateId: string | null) {
  await db.run(
    `INSERT INTO auth_users (id, provider, subject, email, affiliate_id, role)
     VALUES (?1, 'cloudflare_access', ?2, ?3, ?4, ?5)`,
    crypto.randomUUID(),
    subject,
    `${subject}@example.test`,
    affiliateId,
    role,
  );
}

describe("unauthorized access", () => {
  it("fails CLOSED with 503 when authentication is not configured — no demo bypass", async () => {
    const t = openTestDb();
    const env = makeEnv(t, { ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined });
    for (const path of ["/api/me", "/api/leaderboard", "/api/admin/queue"]) {
      const res = await api(env, path);
      expect(res.status, path).toBe(503);
    }
  });

  it("rejects missing and forged tokens", async () => {
    const t = openTestDb();
    const env = makeEnv(t);
    expect((await api(env, "/api/me")).status).toBe(401);
    const forged = await mintToken({ sub: "mallory" }, true);
    expect((await api(env, "/api/me", { token: forged })).status).toBe(401);
    const expired = await mintToken({ sub: "old", exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await api(env, "/api/me", { token: expired })).status).toBe(401);
  });

  it("authenticated but unprovisioned identities get 403, never auto-created", async () => {
    const t = openTestDb();
    const env = makeEnv(t);
    const token = await mintToken({ sub: "newcomer" });
    expect((await api(env, "/api/me", { token })).status).toBe(403);
  });

  it("affiliates cannot reach admin endpoints; admins can", async () => {
    const t = openTestDb();
    await seedAffiliate(t.db, "aff-1");
    await provision(t.db, "ava", "affiliate", "aff-1");
    await provision(t.db, "boss", "admin", null);
    const env = makeEnv(t);

    const avaToken = await mintToken({ sub: "ava" });
    const bossToken = await mintToken({ sub: "boss" });

    expect((await api(env, "/api/me", { token: avaToken })).status).toBe(200);
    expect((await api(env, "/api/admin/queue", { token: avaToken })).status).toBe(403);
    const correction = await api(env, "/api/admin/corrections", {
      method: "POST",
      token: avaToken,
      body: JSON.stringify({ txnId: "x", change: { paymentStatus: "paid" }, reason: "trying to self-verify" }),
    });
    expect(correction.status).toBe(403);

    expect((await api(env, "/api/admin/queue", { token: bossToken })).status).toBe(200);
  });

  it("admin mutations without a reason are rejected", async () => {
    const t = openTestDb();
    await provision(t.db, "boss", "admin", null);
    const env = makeEnv(t);
    const bossToken = await mintToken({ sub: "boss" });
    const res = await api(env, "/api/admin/config/launch", {
      method: "PUT",
      token: bossToken,
      body: JSON.stringify({ launchAt: "2026-10-01T16:00:00.000Z", reason: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("leaderboard field filtering", () => {
  it("returns only permitted public fields and hides unapproved names", async () => {
    const t = openTestDb();
    await seedAffiliate(t.db, "aff-1", { name: "Visible Vera" });
    await seedAffiliate(t.db, "aff-2", { name: "Hidden Hugo", approved: false });
    await t.db.run(
      `INSERT INTO transactions (id, source, external_id, affiliate_id, occurred_at, gross_cents, payment_status, payment_verified, payment_verified_via)
       VALUES ('t1','tapfiliate','o1','aff-1', ?1, 50000, 'paid', 1, 'sellavi')`,
      new Date().toISOString(),
    );
    await provision(t.db, "ava", "affiliate", "aff-1");
    const env = makeEnv(t);
    const token = await mintToken({ sub: "ava", email: "secret@example.test" });

    const res = await api(env, "/api/leaderboard?scope=personal&period=monthly", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Record<string, unknown>[] };
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      expect(new Set(Object.keys(row))).toEqual(
        new Set(["rank", "affiliateId", "displayName", "amountCents", "orders", "movement"]),
      );
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain("Hidden Hugo");
    expect(text).not.toContain("@example.test");
    expect(text).not.toContain("enrolled");
  });
});

describe("webhook endpoint hardening", () => {
  it("fails closed when the webhook secret is unset; rejects wrong secrets", async () => {
    const t = openTestDb();
    const env = makeEnv(t);
    const post = (path: string) =>
      api(env, path, { method: "POST", body: JSON.stringify({ conversion_id: 1 }) });
    expect((await post("/api/webhooks/tapfiliate/anything")).status).toBe(503);

    const env2 = makeEnv(t, { TAPFILIATE_WEBHOOK_SECRET: "s3cret" });
    expect(
      (await api(env2, "/api/webhooks/tapfiliate/wrong", { method: "POST", body: "{}" })).status,
    ).toBe(404);
  });

  it("deduplicates replayed deliveries end-to-end", async () => {
    const t = openTestDb();
    const env = makeEnv(t, { TAPFILIATE_WEBHOOK_SECRET: "s3cret" });
    const body = JSON.stringify({ event_id: "evt-9", conversion_id: 42 });
    const send = () =>
      api(env, "/api/webhooks/tapfiliate/s3cret", { method: "POST", body });

    const first = await send();
    // No API key configured → stored as failed for reconciliation, 202.
    expect(first.status).toBe(202);
    const second = await send();
    expect(second.status).toBe(200);
    expect(((await second.json()) as { deduplicated?: boolean }).deduplicated).toBe(true);
    const events = await t.db.all("SELECT * FROM webhook_events");
    expect(events).toHaveLength(1);
  });
});
