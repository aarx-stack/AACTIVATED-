/**
 * Always-on portal: health checks feed /api/health, the public /status page,
 * and the Admin system panel. A failing integration degrades the system — it
 * never takes the portal down.
 */
import type { HealthStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getIntegrations } from "@/server/integrations";

export interface ComponentHealth {
  component: string;
  label: string;
  status: HealthStatus;
  latencyMs: number | null;
  message: string;
  critical: boolean;
}

export interface SystemHealth {
  status: HealthStatus;
  checkedAt: string;
  components: ComponentHealth[];
}

const QUEUE_HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000;

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - start)];
}

async function checkDatabase(): Promise<ComponentHealth> {
  try {
    const [, ms] = await timed(() => db.$queryRaw`SELECT 1`);
    return {
      component: "database",
      label: "Database",
      status: "OPERATIONAL",
      latencyMs: ms,
      message: "Connected.",
      critical: true,
    };
  } catch (error) {
    return {
      component: "database",
      label: "Database",
      status: "DOWN",
      latencyMs: null,
      message: error instanceof Error ? error.message.split("\n")[0]! : "Unreachable.",
      critical: true,
    };
  }
}

async function checkQueue(): Promise<ComponentHealth> {
  try {
    const last = await db.healthCheck.findFirst({
      where: { component: "worker" },
      orderBy: { checkedAt: "desc" },
    });
    const fresh = last && Date.now() - last.checkedAt.getTime() < QUEUE_HEARTBEAT_MAX_AGE_MS;
    return {
      component: "worker",
      label: "Background worker",
      status: fresh ? "OPERATIONAL" : "DEGRADED",
      latencyMs: null,
      message: fresh
        ? "Heartbeat received."
        : "No recent heartbeat. Start it with `npm run worker`. Jobs queue until it runs.",
      critical: false,
    };
  } catch {
    return {
      component: "worker",
      label: "Background worker",
      status: "UNKNOWN",
      latencyMs: null,
      message: "Cannot read heartbeat.",
      critical: false,
    };
  }
}

function checkAi(): ComponentHealth {
  const env = getEnv();
  if (env.AI_PROVIDER === "mock") {
    return {
      component: "ai",
      label: "AI model (mock)",
      status: "OPERATIONAL",
      latencyMs: null,
      message: "Mock adapter. No external calls.",
      critical: false,
    };
  }
  const configured = Boolean(env.ANTHROPIC_API_KEY);
  return {
    component: "ai",
    label: "AI model (Claude)",
    status: configured ? "OPERATIONAL" : "DEGRADED",
    latencyMs: null,
    message: configured
      ? `Brain: ${env.ANTHROPIC_MODEL_BRAIN}, agents: ${env.ANTHROPIC_MODEL_AGENT}.`
      : "ANTHROPIC_API_KEY missing.",
    critical: false,
  };
}

const LABELS = { GOHIGHLEVEL: "GoHighLevel", QUICKBOOKS: "QuickBooks", SLACK: "Slack" } as const;

async function checkIntegrations(): Promise<ComponentHealth[]> {
  return Promise.all(
    getIntegrations().map(async (adapter) => {
      try {
        const result = await adapter.healthCheck();
        return {
          component: `integration:${adapter.key}`,
          label: `${LABELS[adapter.key]} (${adapter.mode})`,
          status: result.status,
          latencyMs: result.latencyMs,
          message: result.message,
          critical: false,
        };
      } catch (error) {
        return {
          component: `integration:${adapter.key}`,
          label: `${LABELS[adapter.key]} (${adapter.mode})`,
          status: "DOWN" as const,
          latencyMs: null,
          message: error instanceof Error ? error.message : "Health check failed.",
          critical: false,
        };
      }
    }),
  );
}

export function overallStatus(
  components: Pick<ComponentHealth, "status" | "critical">[],
): HealthStatus {
  if (components.some((c) => c.critical && c.status === "DOWN")) return "DOWN";
  if (components.some((c) => c.status !== "OPERATIONAL")) return "DEGRADED";
  return "OPERATIONAL";
}

export async function getSystemHealth(options: { persist?: boolean } = {}): Promise<SystemHealth> {
  const database = await checkDatabase();
  const [queue, integrations] = await Promise.all([
    database.status === "DOWN"
      ? Promise.resolve<ComponentHealth>({
          component: "worker",
          label: "Background worker",
          status: "UNKNOWN",
          latencyMs: null,
          message: "Database unavailable.",
          critical: false,
        })
      : checkQueue(),
    checkIntegrations(),
  ]);
  const components = [database, queue, checkAi(), ...integrations];
  const health: SystemHealth = {
    status: overallStatus(components),
    checkedAt: new Date().toISOString(),
    components,
  };

  if (options.persist && database.status !== "DOWN") {
    await persistHealth(components).catch((e) => console.error("[health] persist failed", e));
  }
  return health;
}

async function persistHealth(components: ComponentHealth[]) {
  const now = new Date();
  await db.healthCheck.createMany({
    data: components
      .filter((c) => c.component !== "worker")
      .map((c) => ({
        component: c.component,
        status: c.status,
        latencyMs: c.latencyMs,
        message: c.message,
        checkedAt: now,
      })),
  });
  for (const c of components.filter((x) => x.component.startsWith("integration:"))) {
    const provider = c.component.split(":")[1] as "GOHIGHLEVEL" | "QUICKBOOKS" | "SLACK";
    await db.integration.updateMany({
      where: { provider },
      data: {
        mode: c.label.endsWith("(live)") ? "LIVE" : "MOCK",
        status: c.status,
        lastCheckedAt: now,
        lastError: c.status === "OPERATIONAL" ? null : c.message,
      },
    });
  }
}

const PUBLIC_TTL_MS = 30_000;
let publicCache: { at: number; value: Promise<SystemHealth> } | undefined;

/**
 * For the public status page and /api/health, which need no sign-in: at most one real check
 * every 30 seconds, so repeated requests cannot use up the integrations' rate limits.
 */
export function getPublicHealth(now = Date.now()): Promise<SystemHealth> {
  if (publicCache && now - publicCache.at < PUBLIC_TTL_MS) return publicCache.value;
  const value = getSystemHealth().catch((error) => {
    publicCache = undefined;
    throw error;
  });
  publicCache = { at: now, value };
  return value;
}
