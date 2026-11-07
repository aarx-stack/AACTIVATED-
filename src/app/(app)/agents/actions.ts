"use server";

import { revalidatePath } from "next/cache";
import { setAgentPaused } from "@/server/agents/manage";
import { requireActionPermission } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz/permissions";

export async function setAgentPausedAction(agentId: string, paused: boolean) {
  try {
    const actor = await requireActionPermission("agent.manage");
    await setAgentPaused(actor, agentId, paused);
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");
    revalidatePath("/team");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof ForbiddenError ? error.message : "Could not update the agent.",
    };
  }
}
