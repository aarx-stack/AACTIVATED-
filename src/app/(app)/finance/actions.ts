"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import {
  recordApprovedPurchase,
  recordManualSpend,
  setBudgetLimit,
} from "@/server/budgets/service";
import { syncQuickBooks } from "@/server/finance/quickbooks";
import { formatUsd } from "@/lib/utils";

function refresh() {
  revalidatePath("/finance");
  revalidatePath("/approvals");
  revalidatePath("/command-center");
}

export async function recordSpendAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("budget.manage");
    const event = await recordManualSpend(actor, {
      budgetId: String(form.get("budgetId") ?? ""),
      amountUsd: String(form.get("amountUsd") ?? ""),
      description: String(form.get("description") ?? ""),
    });
    refresh();
    return { status: "done", message: `Recorded ${formatUsd(event.amountUsd.toNumber())}.` };
  } catch (error) {
    // A refusal under the 75% rule opens an approval request: refresh so it shows up.
    refresh();
    return actionError(error);
  }
}

export async function setLimitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("budget.manage");
    const result = await setBudgetLimit(actor, {
      budgetId: String(form.get("budgetId") ?? ""),
      limitUsd: String(form.get("limitUsd") ?? ""),
      note: String(form.get("note") ?? ""),
    });
    refresh();
    return {
      status: "done",
      message: `${result.budget.name} limit is now ${formatUsd(result.figures.limitUsd)}.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function recordPurchaseAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("budget.manage");
    const event = await recordApprovedPurchase(
      actor,
      z.string().min(1).parse(form.get("approvalId")),
    );
    refresh();
    return {
      status: "done",
      message: `Purchase recorded: ${formatUsd(event.amountUsd.toNumber())}.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function syncQuickBooksAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("finance.view");
    await syncQuickBooks(actor);
    revalidatePath("/finance");
    return { status: "done", message: "Synced with QuickBooks (read-only)." };
  } catch (error) {
    revalidatePath("/finance");
    return actionError(error);
  }
}
