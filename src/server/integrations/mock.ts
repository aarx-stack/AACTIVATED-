import { HealthStatus } from "@/generated/prisma/enums";
import { randomUUID } from "node:crypto";
import type { HealthResult, IntegrationKey, QuickBooksAdapter, SlackAdapter } from "./types";
import { type GoHighLevelAdapter, IntegrationUnavailableError } from "./types";

/**
 * MOCK_INTEGRATIONS_DOWN="SLACK,QUICKBOOKS" simulates an outage so graceful
 * degradation can be demonstrated and tested without touching real services.
 */
function isSimulatedDown(key: IntegrationKey) {
  return (process.env.MOCK_INTEGRATIONS_DOWN ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .includes(key);
}

function mockHealth(key: IntegrationKey): HealthResult {
  if (isSimulatedDown(key)) {
    return { status: HealthStatus.DOWN, latencyMs: 0, message: "Simulated outage (mock)." };
  }
  return { status: HealthStatus.OPERATIONAL, latencyMs: 12, message: "Mock adapter responding." };
}

export const mockGoHighLevel: GoHighLevelAdapter = {
  key: "GOHIGHLEVEL",
  mode: "mock",
  healthCheck: async () => mockHealth("GOHIGHLEVEL"),
  schedulePost: async (input) => {
    if (isSimulatedDown("GOHIGHLEVEL")) {
      throw new IntegrationUnavailableError("GoHighLevel is unavailable. Nothing was scheduled.");
    }
    console.info(
      `[ghl:mock] scheduled ${input.channel} post for ${input.scheduledFor.toISOString()}`,
    );
    return { externalId: `mock-post-${randomUUID().slice(0, 8)}` };
  },
  sendMessage: async (input) => {
    if (isSimulatedDown("GOHIGHLEVEL")) {
      throw new IntegrationUnavailableError("GoHighLevel is unavailable. Nothing was sent.");
    }
    console.info(`[ghl:mock] message to contact ${input.contactId} via ${input.channel}`);
    return { externalId: `mock-msg-${randomUUID().slice(0, 8)}` };
  },
  listSubAccounts: async () => [
    { id: "mock-sub-001", name: "Demo Rep — Jordan Ellis" },
    { id: "mock-sub-002", name: "Demo Rep — Priya Shah" },
  ],
};

export const mockQuickBooks: QuickBooksAdapter = {
  key: "QUICKBOOKS",
  mode: "mock",
  healthCheck: async () => mockHealth("QUICKBOOKS"),
  lastSync: async () => {
    if (isSimulatedDown("QUICKBOOKS")) {
      throw new IntegrationUnavailableError(
        "QuickBooks is unavailable. Showing the last synced data.",
      );
    }
    return { syncedAt: new Date(), transactionCount: 128 };
  },
};

export const mockSlack: SlackAdapter = {
  key: "SLACK",
  mode: "mock",
  healthCheck: async () => mockHealth("SLACK"),
  notify: async (channel, text) => {
    console.info(`[slack:mock] ${channel}: ${text}`);
    return { delivered: !isSimulatedDown("SLACK") };
  },
};
