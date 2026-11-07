"use server";

import { revalidatePath } from "next/cache";
import { ContactStatus } from "@/generated/prisma/enums";
import { actionError, type ActionState } from "@/server/action-result";
import { requireUser } from "@/server/auth/session";
import {
  addContact,
  completeRepTask,
  draftFollowUp,
  planWeek,
  requestRepContent,
  sendFollowUp,
  setContactStatus,
} from "@/server/reps/service";

function refresh() {
  revalidatePath("/my-team");
  revalidatePath("/content");
}

export async function requestRepContentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const result = await requestRepContent(user, {
      brief: String(formData.get("brief") ?? ""),
      channel: String(formData.get("channel") ?? "") as never,
    });
    refresh();
    if (result.status === "blocked")
      return { status: "error", message: result.error ?? "Blocked." };
    const flagged = result.compliance && result.compliance.outcome !== "PASS";
    return {
      status: "done",
      message: flagged
        ? `Drafted. The compliance check flagged ${result.compliance!.violations} item(s), so management will review it.`
        : "Drafted and sent for company approval.",
      href: result.contentItemId ? `/content/${result.contentItemId}` : undefined,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function planWeekAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const goal = String(formData.get("goal") ?? "").trim() || undefined;
    const result = await planWeek(user, { goal });
    refresh();
    return {
      status: "done",
      message: `Your week is planned: ${result.actions} actions. ${result.encouragement}`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleTaskAction(taskId: string, done: boolean): Promise<ActionState> {
  try {
    const user = await requireUser();
    await completeRepTask(user, taskId, done);
    refresh();
    return { status: "done", message: done ? "Done." : "Reopened." };
  } catch (error) {
    return actionError(error);
  }
}

export async function addContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    await addContact(user, {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      preferredChannel: String(formData.get("preferredChannel") ?? "EMAIL") as never,
      consentSource: String(formData.get("consentSource") ?? "") as never,
      consentAt: String(formData.get("consentAt") ?? ""),
      consentEvidence: String(formData.get("consentEvidence") ?? ""),
    });
    refresh();
    return { status: "done", message: "Contact added with their consent record." };
  } catch (error) {
    return actionError(error);
  }
}

export async function optOutAction(contactId: string): Promise<ActionState> {
  try {
    const user = await requireUser();
    await setContactStatus(user, contactId, ContactStatus.OPTED_OUT);
    refresh();
    return {
      status: "done",
      message: "Marked as opted out. No further messages will be drafted or sent.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function draftFollowUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const result = await draftFollowUp(
      user,
      String(formData.get("contactId") ?? ""),
      String(formData.get("note") ?? "") || undefined,
    );
    refresh();
    if (result.status === "blocked")
      return { status: "error", message: result.error ?? "Blocked." };
    return {
      status: "done",
      message: "Follow-up drafted and sent for approval. You can send it once approved.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function sendFollowUpAction(approvalId: string): Promise<ActionState> {
  try {
    const user = await requireUser();
    await sendFollowUp(user, approvalId);
    refresh();
    return { status: "done", message: "Sent through GoHighLevel." };
  } catch (error) {
    return actionError(error);
  }
}
