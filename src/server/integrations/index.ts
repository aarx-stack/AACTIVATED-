import { HealthStatus } from "@/generated/prisma/enums";
import { getEnv } from "@/lib/env";
import { mockGoHighLevel, mockQuickBooks, mockSlack } from "./mock";
import type { HealthResult, IntegrationAdapter, IntegrationKey } from "./types";

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

export function getIntegrations(): IntegrationAdapter[] {
  const env = getEnv();
  return [
    env.INTEGRATION_GOHIGHLEVEL === "live" ? liveNotEnabled("GOHIGHLEVEL") : mockGoHighLevel,
    env.INTEGRATION_QUICKBOOKS === "live" ? liveNotEnabled("QUICKBOOKS") : mockQuickBooks,
    env.INTEGRATION_SLACK === "live" ? liveNotEnabled("SLACK") : mockSlack,
  ];
}

export * from "./types";
