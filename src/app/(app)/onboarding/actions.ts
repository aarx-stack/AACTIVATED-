"use server";

import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/server/action-result";
import { requireUser } from "@/server/auth/session";
import { completeOnboarding } from "@/server/reps/onboarding";

export async function completeOnboardingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    await completeOnboarding(user, {
      acceptContentRules: (formData.get("acceptContentRules") === "on") as true,
      acceptLeadPolicy: (formData.get("acceptLeadPolicy") === "on") as true,
    });
  } catch (error) {
    return actionError(error);
  }
  redirect("/my-team");
}
