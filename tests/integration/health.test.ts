import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getSystemHealth } from "@/server/health/health";
import { db } from "./helpers";

afterEach(() => {
  delete process.env.MOCK_INTEGRATIONS_DOWN;
});
afterAll(() => db.$disconnect());

describe("graceful degradation", () => {
  it("reports DEGRADED (not DOWN) when an integration is unavailable", async () => {
    process.env.MOCK_INTEGRATIONS_DOWN = "SLACK";
    const health = await getSystemHealth();
    expect(health.status).toBe("DEGRADED");
    expect(health.components.find((c) => c.component === "database")?.status).toBe("OPERATIONAL");
    expect(health.components.find((c) => c.component === "integration:SLACK")?.status).toBe("DOWN");
  });

  it("is OPERATIONAL once the worker heartbeat is recent and integrations are up", async () => {
    await db.healthCheck.create({
      data: { component: "worker", status: "OPERATIONAL", message: "test heartbeat" },
    });
    const health = await getSystemHealth();
    expect(health.status).toBe("OPERATIONAL");
  });

  it("persists component results and integration status when asked", async () => {
    await db.integration.upsert({
      where: { provider: "QUICKBOOKS" },
      create: { provider: "QUICKBOOKS", name: "QuickBooks", description: "test" },
      update: {},
    });
    process.env.MOCK_INTEGRATIONS_DOWN = "QUICKBOOKS";
    await getSystemHealth({ persist: true });
    const qb = await db.integration.findUniqueOrThrow({ where: { provider: "QUICKBOOKS" } });
    expect(qb.status).toBe("DOWN");
    expect(qb.lastError).toMatch(/Simulated outage/);
  });
});
