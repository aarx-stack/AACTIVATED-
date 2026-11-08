import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { getEnv } from "@/lib/env";
import { assertRetryable, markTaskDone, runPromptTask } from "@/server/agents/task-work";
import { ForbiddenError } from "@/server/authz/permissions";
import { buildAdapters } from "@/server/integrations";
import type { FetchLike } from "@/server/integrations/live/http";
import {
  disconnectQuickBooks,
  getQuickBooksAccess,
  saveConnection,
} from "@/server/integrations/quickbooks-connection";
import { saveTemplate, sendToAgent } from "@/server/prompts/service";
import { consume } from "@/server/security/rate-limit";
import { ensureWorkflowFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

const env = {
  ...getEnv(),
  INTEGRATION_QUICKBOOKS: "live" as const,
  QUICKBOOKS_CLIENT_ID: "client-id",
  QUICKBOOKS_CLIENT_SECRET: "client-secret",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  QUICKBOOKS_REALM_ID: undefined,
  QUICKBOOKS_ACCESS_TOKEN: undefined,
};
const HOUR = 3_600_000;

beforeAll(async () => {
  await ensureWorkflowFixtures();
  await db.integration.upsert({
    where: { provider: "QUICKBOOKS" },
    create: { provider: "QUICKBOOKS", name: "QuickBooks", description: "test" },
    update: { enabled: true },
  });
});
afterAll(() => db.$disconnect());

describe("sign-in rate limit", () => {
  it("allows a few requests per window, then blocks until the window passes", async () => {
    const key = `test:${randomBytes(6).toString("hex")}`;
    const limit = { max: 3, windowMs: 60_000 };
    const t0 = new Date("2026-11-08T10:00:00Z");
    for (let i = 0; i < 3; i++) {
      expect((await consume(key, limit, { now: new Date(t0.getTime() + i * 1000) })).allowed).toBe(
        true,
      );
    }
    const blocked = await consume(key, limit, { now: new Date(t0.getTime() + 5000) });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(55_000);
    // Blocked attempts are not counted, and old hits are pruned.
    expect(await db.rateLimitHit.count({ where: { key } })).toBe(3);
    expect((await consume(key, limit, { now: new Date(t0.getTime() + 61_000) })).allowed).toBe(
      true,
    );
    expect(await db.rateLimitHit.count({ where: { key } })).toBe(3);
  });
});

describe("QuickBooks connection", () => {
  beforeEach(() => db.integrationConnection.deleteMany({ where: { provider: "QUICKBOOKS" } }));

  const tokens = (suffix: string, accessInMs = HOUR) => ({
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessExpiresAt: new Date(Date.now() + accessInMs),
    refreshExpiresAt: new Date(Date.now() + 90 * 24 * HOUR),
  });

  it("only executives and system admins connect; tokens are encrypted and never audited", async () => {
    const staff = await createUser(Role.STAFF);
    const admin = await createUser(Role.SYSTEM_ADMIN);
    const exec = await createUser(Role.EXECUTIVE);
    await expect(saveConnection(staff, "1234", tokens("a"), { env })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(saveConnection(admin, "not-a-realm", tokens("a"), { env })).rejects.toThrow(
      /unexpected company id/,
    );

    await saveConnection(admin, "1234", tokens("a"), { env });
    const row = await db.integrationConnection.findUniqueOrThrow({
      where: { provider: "QUICKBOOKS" },
    });
    expect(row.accountId).toBe("1234");
    expect(row.accessTokenEnc).not.toContain("access-a");
    expect(row.refreshTokenEnc).not.toContain("refresh-a");

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "integration.connected", actorUserId: admin.id },
    });
    expect(JSON.stringify(audit)).not.toMatch(/access-a|refresh-a/);
    expect(
      await db.notification.count({ where: { userId: exec.id, title: "QuickBooks connected" } }),
    ).toBe(1);
  });

  it("uses the stored token while it is fresh, without calling Intuit", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    await saveConnection(admin, "1234", tokens("fresh"), { env });
    let calls = 0;
    const access = await getQuickBooksAccess({
      env,
      fetch: async () => {
        calls++;
        return new Response("{}");
      },
    });
    expect(access).toEqual({ realmId: "1234", accessToken: "access-fresh" });
    expect(calls).toBe(0);
  });

  it("renews once when it is about to expire, even with two requests at the same time", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    await saveConnection(admin, "1234", tokens("old", 60_000), { env });
    const sent: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      sent.push(String(init?.body));
      await new Promise((r) => setTimeout(r, 50));
      return new Response(
        JSON.stringify({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
          x_refresh_token_expires_in: 8_726_400,
        }),
      );
    };
    const [a, b] = await Promise.all([
      getQuickBooksAccess({ env, fetch: fetchImpl }),
      getQuickBooksAccess({ env, fetch: fetchImpl }),
    ]);
    expect(sent).toHaveLength(1);
    expect(new URLSearchParams(sent[0]).get("refresh_token")).toBe("refresh-old");
    expect(a.accessToken).toBe("access-new");
    expect(b.accessToken).toBe("access-new");
    const row = await db.integrationConnection.findUniqueOrThrow({
      where: { provider: "QUICKBOOKS" },
    });
    expect(row.lastRefreshedAt).not.toBeNull();
    expect(row.accessExpiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
  });

  it("asks for a reconnect when QuickBooks refuses the renewal or it has expired", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    await saveConnection(admin, "1234", tokens("old", 0), { env });
    await expect(
      getQuickBooksAccess({
        env,
        fetch: async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
      }),
    ).rejects.toThrow("QuickBooks refused to renew access. Connect QuickBooks again in Admin.");

    await expect(
      getQuickBooksAccess({ env, now: () => new Date(Date.now() + 100 * 24 * HOUR) }),
    ).rejects.toThrow(/connection has expired/);
    await db.integrationConnection.deleteMany({});
    await expect(getQuickBooksAccess({ env })).rejects.toThrow(/not connected/);
  });

  it("the live adapter reads with the renewed token (GET only)", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    await saveConnection(admin, "1234", tokens("old", 0), { env });
    const seen: { url: string; method: string; auth?: string }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({
        url,
        method: init?.method ?? "GET",
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      });
      if (url.includes("oauth2")) {
        return new Response(
          JSON.stringify({
            access_token: "access-r",
            refresh_token: "refresh-r",
            expires_in: 3600,
          }),
        );
      }
      return new Response(JSON.stringify({ QueryResponse: {} }));
    };
    const qb = buildAdapters(env, fetchImpl).QUICKBOOKS;
    expect(await qb.fetchTransactions(new Date("2026-11-01"))).toEqual([]);
    const reads = seen.filter((s) => s.url.includes("quickbooks.api.intuit.com"));
    expect(reads).toHaveLength(4);
    expect(reads.every((r) => r.method === "GET" && r.auth === "Bearer access-r")).toBe(true);
    expect(reads[0]!.url).toContain("/v3/company/1234/query");
  });

  it("disconnect revokes at Intuit and always deletes the stored tokens", async () => {
    const admin = await createUser(Role.SYSTEM_ADMIN);
    await saveConnection(admin, "1234", tokens("x"), { env });
    let revokedBody = "";
    expect(
      await disconnectQuickBooks(admin, {
        env,
        fetch: async (_url, init) => {
          revokedBody = String(init?.body);
          return new Response("");
        },
      }),
    ).toEqual({ revoked: true, wasConnected: true });
    expect(JSON.parse(revokedBody)).toEqual({ token: "refresh-x" });
    expect(await db.integrationConnection.count()).toBe(0);

    await saveConnection(admin, "1234", tokens("y"), { env });
    expect(
      await disconnectQuickBooks(admin, {
        env,
        fetch: async () => {
          throw new TypeError("offline");
        },
      }),
    ).toEqual({ revoked: false, wasConnected: true });
    expect(await db.integrationConnection.count()).toBe(0);
  });
});

describe("prompt tasks", () => {
  async function promptTask(staff: { id: string; role: Role }, slug = "ops-manager") {
    const { template } = await saveTemplate(staff, {
      name: `Recap ${randomBytes(3).toString("hex")}`,
      description: "For tests",
      body: "Write a recap about {{topic}}.\n- Wins\n- Blockers",
    });
    const agent = await db.agent.findUniqueOrThrow({ where: { slug } });
    const { task } = await sendToAgent(staff, {
      templateId: template.id,
      agentId: agent.id,
      values: { topic: "the week" },
    });
    return { task, agent };
  }

  it("the agent drafts it, records the spend, and a person marks it done", async () => {
    const staff = await createUser(Role.STAFF);
    const { task, agent } = await promptTask(staff);
    const spendBefore = await db.spendEvent.count({ where: { agentId: agent.id } });

    const result = await runPromptTask(task.id);
    expect(result.status).toBe("done");
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe("IN_REVIEW");
    expect(after.output).toMatchObject({ deliverable: expect.stringContaining("Wins") });
    expect(await db.spendEvent.count({ where: { agentId: agent.id } })).toBe(spendBefore + 1);
    expect(await db.auditLog.count({ where: { action: "task.worked", entityId: task.id } })).toBe(
      1,
    );

    // Running it again does nothing: it is already done.
    expect((await runPromptTask(task.id)).status).toBe("skipped");

    const rep = await createUser(Role.PREMIUM_REP);
    await expect(markTaskDone(rep, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    await markTaskDone(staff, task.id);
    const done = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
    await expect(markTaskDone(staff, task.id)).rejects.toThrow(/in review/);
  });

  it("a paused agent blocks the task with a reason; it can be tried again after resuming", async () => {
    const staff = await createUser(Role.STAFF);
    const { task, agent } = await promptTask(staff);
    await db.agent.update({ where: { id: agent.id }, data: { status: "PAUSED" } });
    try {
      const result = await runPromptTask(task.id);
      expect(result.status).toBe("blocked");
      const blocked = await db.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(blocked.status).toBe("BLOCKED");
      expect(blocked.lastError).toMatch(/paused/);
    } finally {
      await db.agent.update({ where: { id: agent.id }, data: { status: "ACTIVE" } });
    }
    await assertRetryable(staff, task.id);
    expect((await runPromptTask(task.id)).status).toBe("done");
    await expect(assertRetryable(staff, task.id)).rejects.toThrow(/blocked/);
  });

  it("refuses agents that are not set up to work prompt tasks", async () => {
    const staff = await createUser(Role.STAFF);
    const tag = randomBytes(4).toString("hex");
    const agent = await db.agent.create({
      data: {
        slug: `no-tasks-${tag}`,
        name: "Plain",
        title: "Plain Agent",
        kind: "DEPARTMENT",
        status: "ACTIVE",
        ownerId: staff.id,
        config: { role: "r", context: "c", dailyRoutine: "d", toolsAllowed: ["report.write"] },
      },
    });
    const { template } = await saveTemplate(staff, {
      name: `Plain ${tag}`,
      description: "For tests",
      body: "Do the thing well and report back to the team.",
    });
    await expect(
      sendToAgent(staff, { templateId: template.id, agentId: agent.id, values: {} }),
    ).rejects.toThrow(/not set up to work prompt tasks/);
  });
});
