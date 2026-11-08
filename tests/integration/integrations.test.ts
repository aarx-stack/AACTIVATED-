import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { getEnv } from "@/lib/env";
import { ForbiddenError } from "@/server/authz/permissions";
import { syncQuickBooks } from "@/server/finance/quickbooks";
import { buildAdapters, getSlack, resetAdapters } from "@/server/integrations";
import { setIntegrationEnabled } from "@/server/integrations/controls";
import type { FetchLike } from "@/server/integrations/live/http";
import { createUser, db } from "./helpers";

beforeAll(async () => {
  for (const provider of ["QUICKBOOKS", "SLACK"] as const) {
    await db.integration.upsert({
      where: { provider },
      create: { provider, name: provider, description: "test" },
      update: { enabled: true },
    });
  }
});
afterAll(async () => {
  resetAdapters();
  await db.$disconnect();
});

describe("Admin off switch", () => {
  it("only system admins can turn integrations on or off, and it is audited", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const admin = await createUser(Role.SYSTEM_ADMIN);
    await expect(setIntegrationEnabled(exec, "SLACK", false)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await setIntegrationEnabled(admin, "SLACK", false);
    try {
      await expect(getSlack().notify("#test", "hello")).rejects.toThrow(/turned off in Admin/);
    } finally {
      await setIntegrationEnabled(admin, "SLACK", true);
    }
    expect(await getSlack().notify("#test", "hello")).toEqual({ delivered: true });
    const audit = await db.auditLog.findMany({
      where: { actorUserId: admin.id, entityType: "Integration" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual(["integration.disabled", "integration.enabled"]);
  });
});

describe("QuickBooks sync (read-only)", () => {
  it("imports new transactions, never duplicates them, and updates changed ones", async () => {
    let amount = 250;
    const methods: string[] = [];
    const fakeQuickBooks: FetchLike = async (url, init) => {
      methods.push(init?.method ?? "GET");
      const entity = /from (\w+)/.exec(decodeURIComponent(url))?.[1];
      const body =
        entity === "Purchase"
          ? {
              QueryResponse: {
                Purchase: [
                  {
                    Id: "it-1",
                    TxnDate: "2026-11-02",
                    TotalAmt: amount,
                    AccountRef: { name: "Software" },
                  },
                ],
              },
            }
          : entity === "SalesReceipt"
            ? {
                QueryResponse: {
                  SalesReceipt: [{ Id: "it-2", TxnDate: "2026-11-03", TotalAmt: 990 }],
                },
              }
            : { QueryResponse: {} };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const env = {
      ...getEnv(),
      INTEGRATION_QUICKBOOKS: "live" as const,
      QUICKBOOKS_REALM_ID: "test-realm",
      QUICKBOOKS_ACCESS_TOKEN: "test-token",
    };
    resetAdapters(buildAdapters(env, fakeQuickBooks));
    const exec = await createUser(Role.EXECUTIVE);

    expect(await syncQuickBooks(exec)).toMatchObject({ created: 2, updated: 0 });
    expect(await syncQuickBooks(exec)).toMatchObject({ created: 0, updated: 0 });
    amount = 275;
    expect(await syncQuickBooks(exec)).toMatchObject({ created: 0, updated: 1 });

    const purchase = await db.transaction.findUniqueOrThrow({
      where: { externalId: "qb-purchase-it-1" },
    });
    expect(purchase.amountUsd.toNumber()).toBe(275);
    expect(purchase.type).toBe("EXPENSE");
    expect(purchase.source).toBe("QUICKBOOKS");
    expect(methods.every((m) => m === "GET")).toBe(true);
    resetAdapters();
  });

  it("keeps the last synced data and marks QuickBooks down when it fails", async () => {
    const env = {
      ...getEnv(),
      INTEGRATION_QUICKBOOKS: "live" as const,
      QUICKBOOKS_REALM_ID: "test-realm",
      QUICKBOOKS_ACCESS_TOKEN: "expired",
    };
    resetAdapters(buildAdapters(env, async () => new Response("", { status: 401 })));
    const exec = await createUser(Role.EXECUTIVE);
    const before = await db.transaction.count();
    await expect(syncQuickBooks(exec)).rejects.toThrow(/refused the credentials/);
    expect(await db.transaction.count()).toBe(before);
    const row = await db.integration.findUniqueOrThrow({ where: { provider: "QUICKBOOKS" } });
    expect(row.status).toBe("DOWN");
    resetAdapters();
  });
});
