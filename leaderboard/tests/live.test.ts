/**
 * Live path: Tapfiliate affiliate/hierarchy import, the conversion payment
 * policy, and the public read-only endpoints (option A). Fixtures mirror the
 * real API shapes; names are synthetic.
 */
import { describe, expect, it } from "vitest";
import { importAffiliates } from "@worker/jobs/import";
import { conversionToTxn, type TapAffiliate, type TapfiliateClient } from "@worker/adapters/tapfiliate";
import worker, { type Env } from "@worker/index";
import { fakeD1, openTestDb } from "./helpers/sqlite";
import type { SqlDb } from "@worker/lib/db";

function stubClient(affiliates: TapAffiliate[]): TapfiliateClient {
  return {
    async *listAffiliates() {
      yield affiliates;
    },
  } as unknown as TapfiliateClient;
}

const aff = (id: string, first: string, last: string, parent: string | null): TapAffiliate =>
  ({ id, firstname: first, lastname: last, parent_id: parent, created_at: "2026-09-01T00:00:00Z" }) as TapAffiliate;

describe("affiliate + hierarchy import", () => {
  it("derives public names, marks approved, and imports verified MLM edges", async () => {
    const { db } = openTestDb();
    const res = await importAffiliates(
      db,
      stubClient([
        aff("lead1", "James", "Wiggins", null),
        aff("kid1", "LaDonna", "Bennett", "lead1"),
        aff("kid2", "jordan", "wiggins", "lead1"),
      ]),
    );
    expect(res).toEqual({ affiliates: 3, edges: 2 });

    const rows = await db.all<{ id: string; display_name: string; display_name_approved: number }>(
      "SELECT id, display_name, display_name_approved FROM affiliates ORDER BY id",
    );
    // id order: kid1, kid2, lead1 — names derived as "First L.", lowercase fixed.
    expect(rows.map((r) => r.display_name)).toEqual(["LaDonna B.", "Jordan W.", "James W."]);
    expect(rows.every((r) => r.display_name_approved === 1)).toBe(true);

    const edges = await db.all<{ parent_id: string; child_id: string; verified: number }>(
      "SELECT parent_id, child_id, verified FROM team_edges ORDER BY child_id",
    );
    expect(edges).toEqual([
      { parent_id: "lead1", child_id: "kid1", verified: 1 },
      { parent_id: "lead1", child_id: "kid2", verified: 1 },
    ]);
  });

  it("is idempotent — re-import updates in place, no duplicate rows/edges", async () => {
    const { db } = openTestDb();
    const roster = [aff("lead1", "James", "Wiggins", null), aff("kid1", "LaDonna", "Bennett", "lead1")];
    await importAffiliates(db, stubClient(roster));
    await importAffiliates(db, stubClient(roster));
    const [{ n: affN }] = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM affiliates");
    const [{ n: edgeN }] = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM team_edges");
    expect(affN).toBe(2);
    expect(edgeN).toBe(1);
  });

  it("skips edges whose parent is not a known affiliate (FK-safe)", async () => {
    const { db } = openTestDb();
    const res = await importAffiliates(db, stubClient([aff("kid1", "A", "B", "ghost-parent")]));
    expect(res.edges).toBe(0);
    const [{ n }] = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM team_edges");
    expect(n).toBe(0);
  });
});

describe("conversion payment policy", () => {
  const base = {
    id: 900,
    amount: 99.97,
    external_id: "SELLAVI-SELLAVI-4890",
    affiliate: { id: "x" },
    created_at: "2026-09-02T21:09:36Z",
  };

  it("counts a normal Sellavi conversion as verified-paid", () => {
    const t = conversionToTxn({ ...base, commissions: [{ kind: "regular", approved: null }] }, "x")!;
    expect(t.paymentStatus).toBe("paid");
    expect(t.paymentVerified).toBe(true);
    expect(t.paymentVerifiedVia).toBe("sellavi");
    expect(t.grossCents).toBe(9997);
    expect(t.orderRef).toBe("#SELLAVI-4890"); // doubled prefix tidied for display
    expect(t.externalId).toBe("SELLAVI-SELLAVI-4890"); // raw id kept for dedupe
  });

  it("excludes a conversion whose commission was dis-approved", () => {
    const t = conversionToTxn({ ...base, commissions: [{ kind: "regular", approved: false }] }, "x")!;
    expect(t.paymentStatus).toBe("unpaid");
    expect(t.paymentVerified).toBe(false);
  });
});

/* ————— public endpoints ————— */

const api = (env: Env, path: string) =>
  worker.fetch(new Request(`https://board.example${path}`), env);

function envWith(raw: ReturnType<typeof openTestDb>["raw"], publicBoard: boolean): Env {
  return {
    DB: fakeD1(raw),
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
    PUBLIC_BOARD: publicBoard ? "1" : undefined,
  } as Env;
}

async function seedBoard(db: SqlDb) {
  await importAffiliates(
    db,
    stubClient([
      aff("lead1", "James", "Wiggins", null),
      aff("kid1", "LaDonna", "Bennett", "lead1"),
    ]),
  );
  await db.run(
    `INSERT INTO transactions (id, source, external_id, affiliate_id, occurred_at, gross_cents, payment_status, payment_verified, payment_verified_via)
     VALUES ('t1','tapfiliate','o1','kid1', ?1, 9997, 'paid', 1, 'sellavi')`,
    new Date().toISOString(),
  );
}

describe("public read-only board (option A)", () => {
  it("404s every /api/public route when PUBLIC_BOARD is unset (fail closed)", async () => {
    const t = openTestDb();
    const env = envWith(t.raw, false);
    for (const p of ["/api/public/summary", "/api/public/board", "/api/public/recognition"]) {
      expect((await api(env, p)).status, p).toBe(404);
    }
  });

  it("serves the board with only permitted fields when enabled", async () => {
    const t = openTestDb();
    await seedBoard(t.db);
    const env = envWith(t.raw, true);

    const res = await api(env, "/api/public/board?scope=personal&period=monthly");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Record<string, unknown>[] };
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      expect(new Set(Object.keys(row))).toEqual(
        new Set(["rank", "affiliateId", "displayName", "amountCents", "orders", "movement"]),
      );
    }
    // No emails, transaction rows, or customer data anywhere in the payload.
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/@|external_id|customer|gross_cents/i);
  });

  it("summary exposes config + honest sync status, no secrets", async () => {
    const t = openTestDb();
    await seedBoard(t.db);
    const env = envWith(t.raw, true);
    const body = (await api(env, "/api/public/summary").then((r) => r.json())) as {
      config: { seatCap: number; launchAt: string | null };
      seatsClaimed: number;
      lastSuccessfulSyncAt: string | null;
    };
    expect(body.config.seatCap).toBe(50);
    expect(body.config.launchAt).toBeNull(); // production truth: launch pending
    expect(body.seatsClaimed).toBe(0);
  });

  it("internal reconcile trigger is gated by the webhook secret", async () => {
    const t = openTestDb();
    const env = { ...envWith(t.raw, true), TAPFILIATE_WEBHOOK_SECRET: "s3cret" } as Env;
    expect((await worker.fetch(new Request("https://board.example/api/internal/reconcile/wrong", { method: "POST" }), env)).status).toBe(404);
    // Correct secret but no API key → reconcile records a skipped run, still 200.
    const ok = await worker.fetch(new Request("https://board.example/api/internal/reconcile/s3cret", { method: "POST" }), env);
    expect(ok.status).toBe(200);
  });
});
