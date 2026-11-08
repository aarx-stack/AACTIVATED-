/**
 * Chooses the adapter for each integration.
 *
 *  INTEGRATION_<NAME>=mock (default)  the mock adapter: no external calls.
 *  INTEGRATION_<NAME>=live            the live adapter, only when its credentials are set;
 *                                      otherwise it reports DOWN and refuses every call.
 *
 * On top of the flag, an administrator can turn any integration off in Admin (Integration.enabled).
 * That switch is checked before every call, mock or live, so one click stops all traffic.
 */
import { HealthStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type Env, getEnv } from "@/lib/env";
import { createLiveGoHighLevel } from "./live/gohighlevel";
import type { FetchLike } from "./live/http";
import { createLiveQuickBooks } from "./live/quickbooks";
import { createLiveSlack } from "./live/slack";
import { mockGoHighLevel, mockQuickBooks, mockSlack } from "./mock";
import {
  type GoHighLevelAdapter,
  type IntegrationAdapter,
  type IntegrationKey,
  IntegrationUnavailableError,
  type QuickBooksAdapter,
  type SlackAdapter,
} from "./types";

const LABEL: Record<IntegrationKey, string> = {
  GOHIGHLEVEL: "GoHighLevel",
  QUICKBOOKS: "QuickBooks",
  SLACK: "Slack",
};

/** Which credentials are missing for live mode (names only, never values). */
export function missingCredentials(key: IntegrationKey, env: Env = getEnv()): string[] {
  const need: Record<IntegrationKey, (keyof Env)[]> = {
    GOHIGHLEVEL: ["GOHIGHLEVEL_API_KEY", "GOHIGHLEVEL_LOCATION_ID"],
    QUICKBOOKS: ["QUICKBOOKS_REALM_ID", "QUICKBOOKS_ACCESS_TOKEN"],
    SLACK: ["SLACK_WEBHOOK_URL"],
  };
  return need[key].filter((name) => !env[name]);
}

/** Live mode without credentials: reports DOWN and refuses every call. */
function unconfigured<T extends IntegrationAdapter>(base: T, missing: string[]): T {
  const message = `Live mode needs ${missing.join(", ")}.`;
  const refuse = async () => {
    throw new IntegrationUnavailableError(`${LABEL[base.key]} is not configured. ${message}`);
  };
  const out = { ...base, mode: "live" as const } as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(base)) {
    if (typeof value === "function") out[name] = refuse;
  }
  out.healthCheck = async () => ({ status: HealthStatus.DOWN, latencyMs: 0, message });
  return out as unknown as T;
}

/**
 * The Admin off switch. Wraps every method except healthCheck: if the integration is turned
 * off in Admin, the call is refused before anything leaves the building.
 */
function withKillSwitch<T extends IntegrationAdapter>(adapter: T): T {
  const out = { ...adapter } as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(adapter)) {
    if (typeof value !== "function" || name === "healthCheck") continue;
    out[name] = async (...args: unknown[]) => {
      const row = await db.integration.findUnique({
        where: { provider: adapter.key },
        select: { enabled: true },
      });
      if (row && !row.enabled) {
        throw new IntegrationUnavailableError(
          `${LABEL[adapter.key]} is turned off in Admin. Nothing was sent.`,
        );
      }
      return (value as (...a: unknown[]) => Promise<unknown>).apply(adapter, args);
    };
  }
  return out as unknown as T;
}

/** Builds the adapters from an environment. `fetch` is injectable for tests. */
export function buildAdapters(env: Env = getEnv(), fetchImpl?: FetchLike) {
  const ghlMissing = missingCredentials("GOHIGHLEVEL", env);
  const qbMissing = missingCredentials("QUICKBOOKS", env);
  const slackMissing = missingCredentials("SLACK", env);

  const ghl: GoHighLevelAdapter =
    env.INTEGRATION_GOHIGHLEVEL !== "live"
      ? mockGoHighLevel
      : ghlMissing.length
        ? unconfigured(mockGoHighLevel, ghlMissing)
        : createLiveGoHighLevel({
            token: env.GOHIGHLEVEL_API_KEY!,
            locationId: env.GOHIGHLEVEL_LOCATION_ID!,
            companyId: env.GOHIGHLEVEL_COMPANY_ID || undefined,
            fetch: fetchImpl,
          });
  const qb: QuickBooksAdapter =
    env.INTEGRATION_QUICKBOOKS !== "live"
      ? mockQuickBooks
      : qbMissing.length
        ? unconfigured(mockQuickBooks, qbMissing)
        : createLiveQuickBooks({
            realmId: env.QUICKBOOKS_REALM_ID!,
            accessToken: env.QUICKBOOKS_ACCESS_TOKEN!,
            environment: env.QUICKBOOKS_ENVIRONMENT,
            fetch: fetchImpl,
          });
  const slack: SlackAdapter =
    env.INTEGRATION_SLACK !== "live"
      ? mockSlack
      : slackMissing.length
        ? unconfigured(mockSlack, slackMissing)
        : createLiveSlack({ webhookUrl: env.SLACK_WEBHOOK_URL!, fetch: fetchImpl });

  return {
    GOHIGHLEVEL: withKillSwitch(ghl),
    QUICKBOOKS: withKillSwitch(qb),
    SLACK: withKillSwitch(slack),
  };
}

let cached: ReturnType<typeof buildAdapters> | undefined;
function adapters() {
  cached ??= buildAdapters();
  return cached;
}

/** Test hook: replace the adapters (or clear, to rebuild from the environment). */
export function resetAdapters(next?: ReturnType<typeof buildAdapters>) {
  cached = next;
}

/** Outbound posting and messaging. Only reached after an approval has been verified. */
export function getGoHighLevel(): GoHighLevelAdapter {
  return adapters().GOHIGHLEVEL;
}

/** Internal alerts. A Slack failure never blocks the action that triggered it. */
export function getSlack(): SlackAdapter {
  return adapters().SLACK;
}

/** Accounting, read-only. */
export function getQuickBooks(): QuickBooksAdapter {
  return adapters().QUICKBOOKS;
}

export function getIntegrations(): IntegrationAdapter[] {
  const a = adapters();
  return [a.GOHIGHLEVEL, a.QUICKBOOKS, a.SLACK];
}

export * from "./types";
