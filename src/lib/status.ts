import type { AgentStatus, HealthStatus } from "@/generated/prisma/enums";
import type { StatusTone } from "@/components/ui/status-dot";

export const AGENT_STATUS: Record<AgentStatus, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  IDLE: { label: "Idle", tone: "info" },
  PAUSED: { label: "Paused", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
  OFFLINE: { label: "Offline", tone: "neutral" },
};

export const HEALTH_STATUS: Record<HealthStatus, { label: string; tone: StatusTone }> = {
  OPERATIONAL: { label: "Operational", tone: "success" },
  DEGRADED: { label: "Degraded", tone: "warning" },
  DOWN: { label: "Down", tone: "danger" },
  UNKNOWN: { label: "Unknown", tone: "neutral" },
};
