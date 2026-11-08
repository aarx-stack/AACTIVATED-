import { z } from "zod";
import { AgentUnavailableError, SkillOutputError } from "@/server/agents/runner";
import { ApprovalConflictError, DispatchBlockedError } from "@/server/approvals/service";
import { ForbiddenError, UnauthenticatedError } from "@/server/authz/permissions";
import { BudgetApprovalRequiredError, BudgetChangePendingError } from "@/server/budgets/errors";
import { IntegrationUnavailableError } from "@/server/integrations/types";

export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string; href?: string; hrefLabel?: string }
  | { status: "done"; message: string; href?: string; hrefLabel?: string };

export const idle: ActionState = { status: "idle" };

/** Turns known domain errors into a message for the person; logs anything unexpected. */
export function actionError(error: unknown): ActionState {
  if (
    error instanceof ForbiddenError ||
    error instanceof ApprovalConflictError ||
    error instanceof DispatchBlockedError ||
    error instanceof IntegrationUnavailableError ||
    error instanceof AgentUnavailableError ||
    error instanceof SkillOutputError
  ) {
    return { status: "error", message: error.message };
  }
  if (error instanceof BudgetApprovalRequiredError || error instanceof BudgetChangePendingError) {
    return error.approvalId
      ? {
          status: "error",
          message: error.message,
          href: `/approvals/${error.approvalId}`,
          hrefLabel: "Review the request",
        }
      : { status: "error", message: error.message };
  }
  if (error instanceof UnauthenticatedError)
    return { status: "error", message: "Please sign in again." };
  if (error instanceof z.ZodError) {
    return { status: "error", message: error.issues[0]?.message ?? "Check the form." };
  }
  console.error("[action]", error);
  return { status: "error", message: "Something went wrong. Nothing was changed or sent." };
}
