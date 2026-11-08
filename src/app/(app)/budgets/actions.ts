"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import { requestLimitChange } from "@/server/budgets/change-requests";

export async function requestLimitChangeAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("budget.request_change");
    const request = await requestLimitChange(actor, {
      budgetId: String(form.get("budgetId") ?? ""),
      limitUsd: String(form.get("limitUsd") ?? ""),
      reason: String(form.get("reason") ?? ""),
    });
    revalidatePath("/budgets");
    revalidatePath("/approvals");
    revalidatePath("/finance");
    return {
      status: "done",
      message: "Sent to the Approval Queue. An executive will decide.",
      href: `/approvals/${request.id}`,
      hrefLabel: "View the request",
    };
  } catch (error) {
    return actionError(error);
  }
}
