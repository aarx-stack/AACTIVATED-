"use client";

import { useActionState } from "react";
import { completeOnboardingAction } from "@/app/(app)/onboarding/actions";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/server/action-result";

export function OnboardingForm({ premium }: { premium: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(completeOnboardingAction, {
    status: "idle",
  });
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex gap-3 rounded-control border border-border p-4 text-sm">
        <input
          type="checkbox"
          name="acceptContentRules"
          required
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span>
          <span className="block font-medium">Content and posting rules</span>
          <span className="text-muted-foreground">
            No medical or health claims. No specific peptide names on social media (use branded
            stack names). Every post is checked automatically and approved by the company before it
            is published.
          </span>
        </span>
      </label>
      <label className="flex gap-3 rounded-control border border-border p-4 text-sm">
        <input
          type="checkbox"
          name="acceptLeadPolicy"
          required
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span>
          <span className="block font-medium">Lead generation policy</span>
          <span className="text-muted-foreground">
            Only people who contacted you or opted in. No scraping, purchased lists, cold DMs,
            follows or comments. Every contact records how they gave consent.
          </span>
        </span>
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending
          ? "Setting up your AI team…"
          : premium
            ? "Accept and set up my AI team"
            : "Accept and meet my Business Coach"}
      </Button>
    </form>
  );
}
