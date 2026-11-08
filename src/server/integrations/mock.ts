import { HealthStatus } from "@/generated/prisma/enums";
import { randomUUID } from "node:crypto";
import type {
  GhlContact,
  HealthResult,
  IntegrationKey,
  QuickBooksAdapter,
  SlackAdapter,
} from "./types";
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

/** Demo GoHighLevel contacts by tag. Example addresses only; nothing is ever sent to them. */
function demoContacts(tag: string, names: string[], dndEvery = 0, noEmailAt = -1): GhlContact[] {
  return names.map((name, i) => ({
    id: `mock-${tag}-${String(i + 1).padStart(3, "0")}`,
    name,
    email: i === noEmailAt ? null : `${tag}${i + 1}@example.test`,
    emailDnd: dndEvery > 0 && (i + 1) % dndEvery === 0,
  }));
}

export const MOCK_CONTACTS: Record<string, GhlContact[]> = {
  clinic: demoContacts(
    "clinic",
    [
      "Northside Wellness Clinic",
      "Harbor Integrative Health",
      "Summit Recovery Center",
      "Lakeview Performance Clinic",
      "Cedar Family Practice",
      "Riverbend Sports Medicine",
      "Oakridge Longevity Clinic",
      "Bayview Health Partners",
    ],
    0,
    5,
  ),
  member: demoContacts(
    "member",
    Array.from({ length: 24 }, (_, i) => `Member ${i + 1}`),
    8,
  ),
  rep: demoContacts("rep", [
    "Jordan Ellis",
    "Priya Shah",
    "Sam Carter",
    "Casey Patel",
    "Morgan Lee",
    "Taylor Reed",
    "Riley Chen",
  ]),
};

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
  listContacts: async ({ tag, page = 1, pageSize = 100 }) => {
    if (isSimulatedDown("GOHIGHLEVEL")) {
      throw new IntegrationUnavailableError("GoHighLevel is unavailable. Nothing was sent.");
    }
    const all = MOCK_CONTACTS[tag] ?? [];
    const start = (page - 1) * pageSize;
    return { contacts: all.slice(start, start + pageSize), hasMore: start + pageSize < all.length };
  },
  setEmailDoNotDisturb: async ({ contactId }) => {
    console.info(`[ghl:mock] email do-not-disturb on for contact ${contactId}`);
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
  // Mock data is seeded directly; the mock sync has nothing new to import.
  fetchTransactions: async () => {
    if (isSimulatedDown("QUICKBOOKS")) {
      throw new IntegrationUnavailableError(
        "QuickBooks is unavailable. Showing the last synced data.",
      );
    }
    return [];
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
