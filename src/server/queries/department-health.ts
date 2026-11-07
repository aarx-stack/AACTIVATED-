/** Pure scoring so it can be unit-tested and explained in the UI. */
import type { AgentStatus } from "@/generated/prisma/enums";

export interface DepartmentHealthInput {
  agentStatuses: AgentStatus[];
  blockedTasks: number;
  overdueTasks: number;
}

export type HealthBand = "healthy" | "watch" | "at_risk";

export interface DepartmentHealth {
  score: number;
  band: HealthBand;
  reasons: string[];
}

export function scoreDepartment(input: DepartmentHealthInput): DepartmentHealth {
  if (input.agentStatuses.length === 0) {
    return { score: 0, band: "at_risk", reasons: ["No agent assigned"] };
  }

  let score = 100;
  const reasons: string[] = [];
  const errors = input.agentStatuses.filter((s) => s === "ERROR").length;
  const paused = input.agentStatuses.filter((s) => s === "PAUSED" || s === "OFFLINE").length;
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

  if (errors) {
    score -= 35 * errors;
    reasons.push(`${plural(errors, "agent")} in error`);
  }
  if (paused) {
    score -= 25 * paused;
    reasons.push(`${plural(paused, "agent")} paused`);
  }
  if (input.blockedTasks) {
    score -= Math.min(30, 8 * input.blockedTasks);
    reasons.push(plural(input.blockedTasks, "blocked task"));
  }
  if (input.overdueTasks) {
    score -= Math.min(20, 5 * input.overdueTasks);
    reasons.push(plural(input.overdueTasks, "overdue task"));
  }

  score = Math.max(0, Math.min(100, score));
  const band: HealthBand = score >= 80 ? "healthy" : score >= 60 ? "watch" : "at_risk";
  return { score, band, reasons: reasons.length ? reasons : ["On track"] };
}
