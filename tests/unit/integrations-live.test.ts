import { describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";
import { buildAdapters, missingCredentials } from "@/server/integrations";
import { createLiveGoHighLevel, GHL_API_VERSION } from "@/server/integrations/live/gohighlevel";
import { callJson, type FetchLike } from "@/server/integrations/live/http";
import { createLiveQuickBooks, toImported } from "@/server/integrations/live/quickbooks";
import { createLiveSlack } from "@/server/integrations/live/slack";
import { IntegrationUnavailableError } from "@/server/integrations/types";

/** A fake HTTP layer: records every request and answers from a list. Nothing leaves the test. */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] =
    [];
  const fn: FetchLike = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift() ?? new Response("{}", { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

const SECRET = "pit-secret-token-123";

describe("HTTP helper", () => {
  it("turns failures into readable IntegrationUnavailableError without leaking details", async () => {
    for (const [status, text] of [
      [401, "refused the credentials (401)"],
      [429, "rate limiting"],
      [500, "returned an error (500)"],
    ] as const) {
      const { fn } = fakeFetch(new Response(`token=${SECRET}`, { status }));
      const error = await callJson("X", "https://x.test", {}, fn).catch((e: Error) => e);
      expect(error).toBeInstanceOf(IntegrationUnavailableError);
      expect((error as Error).message).toContain(text);
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("times out instead of hanging", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    await expect(callJson("X", "https://x.test", { timeoutMs: 20 }, hang)).rejects.toThrow(
      "X did not respond in time.",
    );
  });
});

describe("GoHighLevel (live)", () => {
  const config = { token: SECRET, locationId: "loc_1", companyId: "co_1" };

  it("health check calls the location with the token and API version", async () => {
    const { fn, calls } = fakeFetch(json({ location: { id: "loc_1" } }));
    const result = await createLiveGoHighLevel({ ...config, fetch: fn }).healthCheck();
    expect(result.status).toBe("OPERATIONAL");
    expect(calls[0]!.url).toBe("https://services.leadconnectorhq.com/locations/loc_1");
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]!.headers.Version).toBe(GHL_API_VERSION);
  });

  it("reports DOWN (never throws) when the credentials are refused", async () => {
    const { fn } = fakeFetch(new Response("", { status: 401 }));
    const result = await createLiveGoHighLevel({ ...config, fetch: fn }).healthCheck();
    expect(result.status).toBe("DOWN");
    expect(result.message).not.toContain(SECRET);
  });

  it("schedules a post on the rep's connected account with caption and hashtags", async () => {
    const { fn, calls } = fakeFetch(
      json({
        results: {
          accounts: [
            { id: "acc_fb", platform: "facebook" },
            { id: "acc_ig", platform: "instagram" },
          ],
        },
      }),
      json({ results: { post: { _id: "post_9" } } }),
    );
    const when = new Date("2026-12-01T15:00:00Z");
    const out = await createLiveGoHighLevel({ ...config, fetch: fn }).schedulePost({
      subAccountId: "rep_loc",
      channel: "INSTAGRAM",
      caption: "Morning routine tips.",
      hashtags: ["#routine"],
      scheduledFor: when,
    });
    expect(out).toEqual({ externalId: "post_9" });
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toBe(
      "https://services.leadconnectorhq.com/social-media-posting/rep_loc/posts",
    );
    expect(calls[1]!.body).toMatchObject({
      accountIds: ["acc_ig"],
      summary: "Morning routine tips.\n\n#routine",
      scheduleDate: when.toISOString(),
    });
  });

  it("refuses when no account is connected for the channel, or the channel is unsupported", async () => {
    const { fn } = fakeFetch(json({ results: { accounts: [] } }));
    const ghl = createLiveGoHighLevel({ ...config, fetch: fn });
    const input = {
      subAccountId: "l",
      caption: "Hello there",
      hashtags: [],
      scheduledFor: new Date(),
    };
    await expect(ghl.schedulePost({ ...input, channel: "TIKTOK" })).rejects.toThrow(
      /No tiktok account/,
    );
    await expect(ghl.schedulePost({ ...input, channel: "EMAIL" })).rejects.toThrow(/cannot post/);
  });

  it("sends messages to a contact with the right conversation type", async () => {
    const { fn, calls } = fakeFetch(json({ messageId: "m1" }), json({ messageId: "m2" }));
    const ghl = createLiveGoHighLevel({ ...config, fetch: fn });
    await ghl.sendMessage({
      subAccountId: "l",
      contactId: "c1",
      channel: "EMAIL",
      subject: "Hi",
      message: "Hello",
    });
    await ghl.sendMessage({
      subAccountId: "l",
      contactId: "c1",
      channel: "INSTAGRAM",
      message: "Hello",
    });
    expect(calls[0]!.body).toEqual({
      type: "Email",
      contactId: "c1",
      message: "Hello",
      subject: "Hi",
      html: "Hello",
    });
    expect(calls[1]!.body).toEqual({ type: "IG", contactId: "c1", message: "Hello" });
    await expect(
      ghl.sendMessage({ subAccountId: "l", contactId: "c1", channel: "YOUTUBE", message: "x" }),
    ).rejects.toThrow(/cannot send/);
  });
});

describe("QuickBooks (live, read-only)", () => {
  const config = {
    auth: async () => ({ realmId: "123", accessToken: SECRET }),
    environment: "sandbox" as const,
  };

  it("only ever issues GET requests, and maps each kind of transaction", async () => {
    const { fn, calls } = fakeFetch(
      json({
        QueryResponse: {
          Purchase: [
            {
              Id: "1",
              TxnDate: "2026-11-02",
              TotalAmt: 120.5,
              AccountRef: { name: "Software" },
              EntityRef: { name: "Acme" },
            },
          ],
        },
      }),
      json({
        QueryResponse: {
          SalesReceipt: [
            { Id: "7", TxnDate: "2026-11-03", TotalAmt: 900, CustomerRef: { name: "Member" } },
          ],
        },
      }),
      json({ QueryResponse: {} }),
      json({
        QueryResponse: { RefundReceipt: [{ Id: "3", TxnDate: "2026-11-04", TotalAmt: -50 }] },
      }),
    );
    const rows = await createLiveQuickBooks({ ...config, fetch: fn }).fetchTransactions(
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls[0]!.url).toContain(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/123/query?query=",
    );
    expect(decodeURIComponent(calls[0]!.url)).toContain(
      "select * from Purchase where TxnDate >= '2026-11-01'",
    );
    expect(calls[0]!.url).toContain("minorversion=75");
    expect(rows).toEqual([
      expect.objectContaining({
        externalId: "qb-purchase-1",
        type: "EXPENSE",
        category: "Software",
        description: "Acme",
        amountUsd: 120.5,
      }),
      expect.objectContaining({
        externalId: "qb-salesreceipt-7",
        type: "REVENUE",
        category: "Sales",
      }),
      expect.objectContaining({ externalId: "qb-refundreceipt-3", type: "REFUND", amountUsd: 50 }),
    ]);
  });

  it("uses the private note as the description when there is one", () => {
    expect(
      toImported("Purchase", "EXPENSE", {
        Id: "9",
        TxnDate: "2026-01-02",
        TotalAmt: 5,
        PrivateNote: " Team lunch ",
      }).description,
    ).toBe("Team lunch");
  });

  it("reports DOWN when QuickBooks cannot be reached", async () => {
    const { fn } = fakeFetch(new TypeError("fetch failed"));
    expect((await createLiveQuickBooks({ ...config, fetch: fn }).healthCheck()).status).toBe(
      "DOWN",
    );
  });
});

describe("Slack (live)", () => {
  const webhookUrl = "https://hooks.slack.com/services/T000/B000/XXXX";
  it("posts the alert to the webhook; the health check never posts", async () => {
    const { fn, calls } = fakeFetch(new Response("ok", { status: 200 }));
    const slack = createLiveSlack({ webhookUrl, fetch: fn });
    expect((await slack.healthCheck()).status).toBe("OPERATIONAL");
    expect(calls).toHaveLength(0);
    expect(await slack.notify("#management", "Budget reached 75%")).toEqual({ delivered: true });
    expect(calls[0]).toMatchObject({
      url: webhookUrl,
      method: "POST",
      body: { text: "*#management* Budget reached 75%" },
    });
  });
  it("rejects a URL that is not a Slack webhook", async () => {
    expect(
      (await createLiveSlack({ webhookUrl: "https://example.com/x" }).healthCheck()).status,
    ).toBe("DOWN");
  });
});

describe("feature flags", () => {
  const base = getEnv({ DATABASE_URL: "postgresql://x" } as unknown as NodeJS.ProcessEnv);

  it("uses mocks by default and never calls fetch", async () => {
    const { fn, calls } = fakeFetch();
    const adapters = buildAdapters(base, fn);
    expect([adapters.GOHIGHLEVEL.mode, adapters.QUICKBOOKS.mode, adapters.SLACK.mode]).toEqual([
      "mock",
      "mock",
      "mock",
    ]);
    await adapters.GOHIGHLEVEL.healthCheck();
    expect(calls).toHaveLength(0);
  });

  it("live without credentials reports what is missing and refuses calls without any request", async () => {
    const env = {
      ...base,
      INTEGRATION_GOHIGHLEVEL: "live" as const,
      INTEGRATION_QUICKBOOKS: "live" as const,
    };
    expect(missingCredentials("GOHIGHLEVEL", env)).toEqual([
      "GOHIGHLEVEL_API_KEY",
      "GOHIGHLEVEL_LOCATION_ID",
    ]);
    const { fn, calls } = fakeFetch();
    const adapters = buildAdapters(env, fn);
    const health = await adapters.GOHIGHLEVEL.healthCheck();
    expect(health.status).toBe("DOWN");
    expect(health.message).toContain("GOHIGHLEVEL_API_KEY");
    await expect(adapters.QUICKBOOKS.lastSync()).rejects.toThrow(/not configured/);
    expect(calls).toHaveLength(0);
  });

  it("live with credentials uses the real adapter", async () => {
    const env = {
      ...base,
      INTEGRATION_GOHIGHLEVEL: "live" as const,
      GOHIGHLEVEL_API_KEY: SECRET,
      GOHIGHLEVEL_LOCATION_ID: "loc_1",
    };
    const { fn, calls } = fakeFetch(json({}));
    const adapters = buildAdapters(env, fn);
    expect(adapters.GOHIGHLEVEL.mode).toBe("live");
    expect((await adapters.GOHIGHLEVEL.healthCheck()).status).toBe("OPERATIONAL");
    expect(calls).toHaveLength(1);
  });
});

describe("GoHighLevel contacts (live)", () => {
  const config = { token: SECRET, locationId: "loc_1" };

  it("searches the company location by tag and marks do-not-disturb", async () => {
    const { fn, calls } = fakeFetch(
      json({
        contacts: [
          { id: "c1", firstName: "Ann", lastName: "Lee", email: "ann@example.test" },
          { id: "c2", contactName: "Bay Clinic", email: "bay@example.test", dnd: true },
          {
            id: "c3",
            contactName: "Cove",
            email: "cove@example.test",
            dndSettings: { Email: { status: "active" } },
          },
          { id: "c4", contactName: "No Mail" },
        ],
        total: 104,
      }),
    );
    const out = await createLiveGoHighLevel({ ...config, fetch: fn }).listContacts({
      tag: "clinic",
      page: 1,
      pageSize: 100,
    });
    expect(calls[0]).toMatchObject({
      url: "https://services.leadconnectorhq.com/contacts/search",
      method: "POST",
      body: {
        locationId: "loc_1",
        page: 1,
        pageLimit: 100,
        filters: [{ field: "tags", operator: "contains", value: ["clinic"] }],
      },
    });
    expect(out.hasMore).toBe(true);
    expect(out.contacts).toEqual([
      { id: "c1", name: "Ann Lee", email: "ann@example.test", emailDnd: false },
      { id: "c2", name: "Bay Clinic", email: "bay@example.test", emailDnd: true },
      { id: "c3", name: "Cove", email: "cove@example.test", emailDnd: true },
      { id: "c4", name: "No Mail", email: null, emailDnd: false },
    ]);
  });

  it("an unsubscribe turns on email do-not-disturb for the contact", async () => {
    const { fn, calls } = fakeFetch(json({}));
    await createLiveGoHighLevel({ ...config, fetch: fn }).setEmailDoNotDisturb({
      subAccountId: "company",
      contactId: "c9",
    });
    expect(calls[0]).toMatchObject({
      url: "https://services.leadconnectorhq.com/contacts/c9",
      method: "PUT",
      body: { dndSettings: { Email: { status: "active" } } },
    });
  });

  it("emails carry the HTML version when there is one", async () => {
    const { fn, calls } = fakeFetch(json({ messageId: "m1" }));
    await createLiveGoHighLevel({ ...config, fetch: fn }).sendMessage({
      subAccountId: "company",
      contactId: "c1",
      channel: "EMAIL",
      subject: "Hi",
      message: "Plain",
      html: "<p>Rich</p>",
    });
    expect(calls[0]!.body).toMatchObject({ type: "Email", message: "Plain", html: "<p>Rich</p>" });
  });
});
