"use client";

import Link from "next/link";
import { useActionState, useTransition, useState } from "react";
import type * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/server/action-result";

export function ActionFeedback({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn("text-sm", state.status === "error" ? "text-danger" : "text-success")}
    >
      {state.message}
      {state.status === "done" && state.href && (
        <>
          {" "}
          <Link
            href={state.href}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Open
          </Link>
        </>
      )}
    </p>
  );
}

/** A form bound to a server action, with pending state and an accessible result message. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  className,
  buttonVariant,
  testId,
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: React.ReactNode;
  pendingLabel?: string;
  children?: React.ReactNode;
  className?: string;
  buttonVariant?: ButtonProps["variant"];
  testId?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      return result;
    },
    { status: "idle" },
  );
  return (
    <form
      action={formAction}
      className={cn("flex flex-col gap-3", className)}
      data-testid={testId}
      key={resetOnSuccess && state.status === "done" ? state.message : undefined}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} variant={buttonVariant}>
          {pending ? (pendingLabel ?? "Working…") : submitLabel}
        </Button>
      </div>
      <div aria-live="polite">
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

/** A single button bound to a server action (use `.bind(null, ...)` for arguments). */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  size = "sm",
  label,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({ status: "idle" });
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending}
        aria-label={label}
        onClick={() => start(async () => setState(await action()))}
      >
        {children}
      </Button>
      {state.status === "error" && (
        <span role="alert" className="text-xs text-danger">
          {state.message}
        </span>
      )}
    </span>
  );
}

export const textareaClass =
  "w-full rounded-control border border-border bg-surface-solid px-3 py-2 text-sm text-foreground placeholder:text-subtle-foreground focus-visible:border-border-strong";
export const selectClass =
  "h-10 w-full rounded-control border border-border bg-surface-solid px-3 text-sm text-foreground focus-visible:border-border-strong";
