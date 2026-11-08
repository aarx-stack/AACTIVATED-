import { HealthStatus } from "@/generated/prisma/enums";
import { getEnv } from "@/lib/env";
import { mockGoHighLevel, mockQuickBooks, mockSlack } from "./mock";
import {
  type GoHighLevelAdapter,
  type HealthResult,
  type IntegrationAdapter,
  type IntegrationKey,
  IntegrationUnavailableError,
  type QuickBooksAdapter,
  type SlackAdapter,
} from "./types";

/**
 * Live adapters are intentionally not implemented in Phase 1. If someone flips a
 * flag to "live", the integration reports DOWN instead of calling anything —
 * no live external API is ever called without explicit approval.
 */
function liveNotEnabled(key: IntegrationKey): IntegrationAdapter {
  return {
    key,
    mode: "live",
    healthCheck: async (): Promise<HealthResult> => ({
      status: HealthStatus.DOWN,
      latencyMs: 0,
      message: "Live adapter not enabled yet (planned for Phase 5, requires approval).",
    }),
  };
}

/** The GoHighLevel adapter for outbound work. Live mode is not enabled until Phase 5. */
export function getGoHighLevel(): GoHighLevelAdapter {
  if (getEnv().INTEGRATION_GOHIGHLEVEL === "live") {
    const unavailable = async (): Promise<never> => {
      throw new IntegrationUnavailableError("The live GoHighLevel adapter is not enabled yet.");
    };
    return {
      ...mockGoHighLevel,
      mode: "live",
      schedulePost: unavailable,
      sendMessage: unavailable,
    };
  }
  return mockGoHighLevel;
}

/** Slack for internal alerts. Live mode is not enabled: it reports "not delivered" instead. */
export function getSlack(): SlackAdapter {
  if (getEnv().INTEGRATION_SLACK === "live") {
    return { ...mockSlack, mode: "live", notify: async () => ({ delivered: false }) };
  }
  return mockSlack;
}

/** QuickBooks, read-only. Live mode is not enabled: sync reports unavailable. */
export function getQuickBooks(): QuickBooksAdapter {
  if (getEnv().INTEGRATION_QUICKBOOKS === "live") {
    return {
      ...mockQuickBooks,
      mode: "live",
      lastSync: async () => {
        throw new IntegrationUnavailableError("The live QuickBooks adapter is not enabled yet.");
      },
    };
  }
  return mockQuickBooks;
}

export function getIntegrations(): IntegrationAdapter[] {
  const env = getEnv();
  return [
    env.INTEGRATION_GOHIGHLEVEL === "live" ? liveNotEnabled("GOHIGHLEVEL") : mockGoHighLevel,
    env.INTEGRATION_QUICKBOOKS === "live" ? liveNotEnabled("QUICKBOOKS") : mockQuickBooks,
    env.INTEGRATION_SLACK === "live" ? liveNotEnabled("SLACK") : mockSlack,
  ];
}

export * from "./types";
