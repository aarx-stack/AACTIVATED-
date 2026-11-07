/**
 * Commission plan progress.
 *
 * PLACEHOLDER PLAN: replace the ranks and thresholds with AACTIVATED's real
 * commission plan. The page reads everything from here, so only this file changes.
 * Requirements never promise income; they describe what a rank needs.
 */
import type { PresenterStatus } from "@/generated/prisma/enums";

export interface RankRequirement {
  key: "monthEarningsUsd" | "teamSize" | "presenter";
  label: string;
  target: number;
}

export interface Rank {
  name: string;
  requirements: RankRequirement[];
}

export const COMMISSION_PLAN: Rank[] = [
  { name: "Associate", requirements: [] },
  {
    name: "Builder",
    requirements: [
      { key: "teamSize", label: "Active team members", target: 3 },
      { key: "monthEarningsUsd", label: "Earnings this month", target: 250 },
    ],
  },
  {
    name: "Presenter",
    requirements: [
      { key: "teamSize", label: "Active team members", target: 5 },
      { key: "monthEarningsUsd", label: "Earnings this month", target: 750 },
      { key: "presenter", label: "Presenter certification", target: 1 },
    ],
  },
  {
    name: "Leader",
    requirements: [
      { key: "teamSize", label: "Active team members", target: 10 },
      { key: "monthEarningsUsd", label: "Earnings this month", target: 2000 },
      { key: "presenter", label: "Presenter certification", target: 1 },
    ],
  },
];

export interface RepMetrics {
  monthEarningsUsd: number;
  teamSize: number;
  presenterStatus: PresenterStatus;
}

function value(req: RankRequirement, m: RepMetrics) {
  if (req.key === "presenter") return m.presenterStatus === "PRESENTER" ? 1 : 0;
  return m[req.key];
}

export function meetsRank(rank: Rank, m: RepMetrics) {
  return rank.requirements.every((r) => value(r, m) >= r.target);
}

export interface PlanProgress {
  current: Rank;
  next: Rank | null;
  requirements: { label: string; current: number; target: number; met: boolean; ratio: number }[];
  /** Overall progress to the next rank, 0..1 (average of capped requirement ratios). */
  overall: number;
}

export function commissionProgress(m: RepMetrics, plan: Rank[] = COMMISSION_PLAN): PlanProgress {
  // Ranks are cumulative: climb while the next rank's requirements are all met.
  let currentIndex = 0;
  while (currentIndex + 1 < plan.length && meetsRank(plan[currentIndex + 1]!, m)) currentIndex++;
  const current = plan[currentIndex]!;
  const next = plan[currentIndex + 1] ?? null;
  const requirements = (next?.requirements ?? []).map((r) => {
    const v = value(r, m);
    return {
      label: r.label,
      current: v,
      target: r.target,
      met: v >= r.target,
      ratio: Math.min(1, r.target ? v / r.target : 1),
    };
  });
  const overall = requirements.length
    ? requirements.reduce((n, r) => n + r.ratio, 0) / requirements.length
    : 1;
  return { current, next, requirements, overall };
}
