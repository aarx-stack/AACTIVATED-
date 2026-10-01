"use client";

import { useActionState } from "react";
import { loginAction, mfaVerifyAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/action-form";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = { status: "idle", message: "" };

export function DemoLoginForm() {
  const [state, action] = useActionState(loginAction, initial);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && (
        <p className="notice notice-danger" role="alert">
          {state.message}
        </p>
      )}
      <SubmitButton className="btn btn-primary w-full" pendingLabel="Opening demo…" testId="demo-login">
        Enter demo workspace
      </SubmitButton>
    </form>
  );
}

export function OwnerLoginForm() {
  const [state, action] = useActionState(loginAction, initial);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && (
        <p className="notice notice-danger" role="alert">
          {state.message}
        </p>
      )}
      <label className="block">
        <span className="label">Owner email</span>
        <input className="input" type="email" name="email" autoComplete="username" required />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required />
      </label>
      <SubmitButton className="btn btn-primary w-full" pendingLabel="Signing in…" testId="owner-login">
        Sign in
      </SubmitButton>
    </form>
  );
}

export function MfaForm() {
  const [state, action] = useActionState(mfaVerifyAction, initial);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && (
        <p className="notice notice-danger" role="alert">
          {state.message}
        </p>
      )}
      <label className="block">
        <span className="label">6-digit code from your authenticator app</span>
        <input className="input text-center text-2xl tracking-[0.4em]" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      </label>
      <SubmitButton className="btn btn-primary w-full" pendingLabel="Verifying…">
        Verify
      </SubmitButton>
    </form>
  );
}
