"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import { PHASE_LABEL } from "@/server/roadmap/policy";
import { addIdea, addToMap, advanceProject, setProgress } from "@/server/roadmap/service";

function refresh() {
  revalidatePath("/roadmap");
  revalidatePath("/approvals");
}

export async function advanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("roadmap.view");
    const result = await advanceProject(actor, {
      projectId: String(form.get("projectId") ?? ""),
      note: String(form.get("note") ?? "") || undefined,
    });
    refresh();
    return result.status === "advanced"
      ? { status: "done", message: `Moved to ${PHASE_LABEL[result.to]}.` }
      : {
          status: "done",
          message: "Sent for executive approval.",
          href: `/approvals/${result.approvalId}`,
          hrefLabel: "View request",
        };
  } catch (error) {
    return actionError(error);
  }
}

export async function addIdeaAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("roadmap.manage");
    await addIdea(actor, {
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
    });
    refresh();
    return { status: "done", message: "Idea added to the backlog." };
  } catch (error) {
    return actionError(error);
  }
}

export async function addToMapAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("roadmap.manage");
    await addToMap(actor, z.string().min(1).parse(form.get("projectId")));
    refresh();
    return { status: "done", message: "Added to the map." };
  } catch (error) {
    return actionError(error);
  }
}

export async function progressAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("roadmap.manage");
    await setProgress(actor, {
      projectId: String(form.get("projectId") ?? ""),
      progress: String(form.get("progress") ?? ""),
    });
    refresh();
    return { status: "done", message: "Progress saved." };
  } catch (error) {
    return actionError(error);
  }
}
