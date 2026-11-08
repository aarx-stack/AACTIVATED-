/**
 * Development & Tokenization Map rules. Pure and unit-tested.
 *
 *  - Projects move one phase at a time: Idea -> Build -> Review -> Launch.
 *  - A move is "gated" when the project is locked, when it is the tokenization platform, or when
 *    it goes to Launch and the project requires executive approval.
 *  - Staff move ungated projects themselves; for a gated move they request approval in the
 *    Approval Queue, and the card shows "Pending Approval".
 *  - Executives decide gated moves, always with a written note. The tokenization platform stays
 *    locked after every move, so each step needs a fresh executive decision.
 */
import { ProjectPhase, type Role } from "@/generated/prisma/enums";
import { can } from "@/server/authz/permissions";

export const PHASES: readonly ProjectPhase[] = [
  ProjectPhase.IDEA,
  ProjectPhase.BUILD,
  ProjectPhase.REVIEW,
  ProjectPhase.LAUNCH,
];

export const PHASE_LABEL: Record<ProjectPhase, string> = {
  IDEA: "Idea",
  BUILD: "Build",
  REVIEW: "Review",
  LAUNCH: "Launch",
};

export const MIN_DECISION_NOTE = 10;

export function nextPhase(phase: ProjectPhase): ProjectPhase | null {
  const i = PHASES.indexOf(phase);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1]! : null;
}

export interface ProjectGate {
  phase: ProjectPhase;
  locked: boolean;
  requiresExecutiveApproval: boolean;
  isTokenization: boolean;
}

/** Does moving into `to` need an executive decision? */
export function isGatedMove(project: ProjectGate, to: ProjectPhase): boolean {
  return (
    project.locked ||
    project.isTokenization ||
    (to === ProjectPhase.LAUNCH && project.requiresExecutiveApproval)
  );
}

export type AdvanceDecision =
  | { action: "advance"; to: ProjectPhase; noteRequired: boolean }
  | { action: "request"; to: ProjectPhase }
  | { action: "refuse"; reason: string };

/** What happens when this role asks to move the project to its next phase. */
export function decideAdvance(role: Role, project: ProjectGate): AdvanceDecision {
  if (!can(role, "roadmap.manage")) {
    return { action: "refuse", reason: "Your role cannot move projects on the map." };
  }
  const to = nextPhase(project.phase);
  if (!to) return { action: "refuse", reason: "This project has already launched." };
  if (!isGatedMove(project, to)) return { action: "advance", to, noteRequired: false };
  if (can(role, "roadmap.approve_launch")) return { action: "advance", to, noteRequired: true };
  return { action: "request", to };
}

/** The tokenization platform stays locked after every move: each step needs a new decision. */
export function lockedAfterMove(project: Pick<ProjectGate, "isTokenization">): boolean {
  return project.isTokenization;
}

export type StageState = "done" | "current" | "next" | "locked" | "later";

/** How each phase cell on a project's row is drawn. */
export function stageStates(project: ProjectGate): Record<ProjectPhase, StageState> {
  const current = PHASES.indexOf(project.phase);
  const out = {} as Record<ProjectPhase, StageState>;
  PHASES.forEach((phase, i) => {
    if (i < current) out[phase] = "done";
    else if (i === current) out[phase] = "current";
    else if (isGatedMove(project, phase)) out[phase] = "locked";
    else out[phase] = i === current + 1 ? "next" : "later";
  });
  return out;
}

export function overallProgress(projects: { phase: ProjectPhase; progress: number }[]): number {
  if (projects.length === 0) return 0;
  const total = projects.reduce((n, p) => {
    if (p.phase === ProjectPhase.LAUNCH) return n + 1;
    const i = PHASES.indexOf(p.phase);
    return n + (i + Math.min(100, Math.max(0, p.progress)) / 100) / (PHASES.length - 1);
  }, 0);
  return total / projects.length;
}
