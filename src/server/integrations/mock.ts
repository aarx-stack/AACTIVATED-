import { HealthStatus } from "@/generated/prisma/enums";
import type {
  GoHighLevelAdapter,
  HealthResult,
  IntegrationKey,
  QuickBooksAdapter,
  SlackAdapter,
} from "./types";

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
  listSubAccounts: async () => [
    { id: "mock-sub-001", name: "Demo Rep — Jordan Ellis" },
    { id: "mock-sub-002", name: "Demo Rep — Priya Shah" },
  ],
};

export const mockQuickBooks: QuickBooksAdapter = {
  key: "QUICKBOOKS",
  mode: "mock",
  healthCheck: async () => mockHealth("QUICKBOOKS"),
  lastSync: async () => ({
    syncedAt: new Date(Date.now() - 1000 * 60 * 42),
    transactionCount: 128,
  }),
};

export const mockSlack: SlackAdapter = {
  key: "SLACK",
  mode: "mock",
  healthCheck: async () => mockHealth("SLACK"),
  notify: async (channel, text) => {
    console.info(`[slack:mock] #${channel}: ${text}`);
    return { delivered: !isSimulatedDown("SLACK") };
  },
};
