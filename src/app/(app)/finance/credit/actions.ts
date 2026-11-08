"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import {
  addTradeline,
  recordScore,
  setTradelineStatus,
  updateMilestone,
} from "@/server/finance/credit";

const refresh = () => {
  revalidatePath("/finance/credit");
  revalidatePath("/finance");
};

export async function updateMilestoneAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("credit.manage");
    await updateMilestone(actor, {
      id: String(form.get("id") ?? ""),
      status: String(form.get("status") ?? "") as never,
      notes: String(form.get("notes") ?? ""),
    });
    refresh();
    return { status: "done", message: "Saved." };
  } catch (error) {
    return actionError(error);
  }
}

export async function addTradelineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("credit.manage");
    const limit = String(form.get("limitUsd") ?? "");
    await addTradeline(actor, {
      vendor: String(form.get("vendor") ?? ""),
      kind: String(form.get("kind") ?? "") as never,
      reportsTo: form.getAll("reportsTo").map(String) as never,
      limitUsd: limit ? limit : undefined,
      status: String(form.get("status") ?? "APPLIED") as never,
      notes: String(form.get("notes") ?? ""),
    });
    refresh();
    return { status: "done", message: "Account added." };
  } catch (error) {
    return actionError(error);
  }
}

export async function setTradelineStatusAction(id: string, status: string) {
  const actor = await requireActionPermission("credit.manage");
  await setTradelineStatus(actor, id, status as never);
  refresh();
}

export async function recordScoreAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("credit.manage");
    const date = String(form.get("recordedAt") ?? "");
    await recordScore(actor, {
      bureau: String(form.get("bureau") ?? "") as never,
      score: String(form.get("score") ?? ""),
      recordedAt: date ? `${date}T12:00:00` : undefined,
      note: String(form.get("note") ?? ""),
    });
    refresh();
    return { status: "done", message: "Score recorded." };
  } catch (error) {
    return actionError(error);
  }
}
