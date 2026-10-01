"use client";

import { useActionState } from "react";
import { testConnectionAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/action-form";
import type { ActionState } from "@/lib/action-state";

export function TestConnectionButton({ label }: { label: string }) {
  const [state, action] = useActionState(testConnectionAction, { status: "idle", message: "" } as ActionState);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton className="btn btn-primary w-full" pendingLabel="Testing…" testId="test-connection">
        {label}
      </SubmitButton>
      {state.status !== "idle" && (
        <p className={`notice ${state.status === "error" ? "notice-danger" : "notice-ok"} text-xs`} role="status" data-testid="test-connection-result">
          {state.message}
        </p>
      )}
    </form>
  );
}
