"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action-state";

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  className = "btn btn-primary",
  disabled,
  name,
  value,
  testId,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  testId?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      name={name}
      value={value}
      data-testid={testId}
    >
      {pending ? (
        <>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Form bound to a server action. Shows loading, success and error states. The submit button is
 * disabled while the request is in flight (the server independently prevents duplicates).
 */
export function ActionForm({
  action,
  children,
  className = "",
  encType,
  id,
  testId,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  encType?: "multipart/form-data";
  id?: string;
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, { status: "idle", message: "" } as ActionState);
  return (
    <form action={formAction} className={className} encType={encType} id={id} data-testid={testId}>
      {state.status === "error" && (
        <div className="notice notice-danger mb-4" role="alert" data-testid="form-error">
          {state.message}
        </div>
      )}
      {state.status === "success" && state.message && (
        <div className="notice notice-ok mb-4" role="status" data-testid="form-success">
          {state.message}
        </div>
      )}
      {children}
    </form>
  );
}
