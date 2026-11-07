"use client";

import { Mail } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestMagicLink, type LoginState } from "./actions";

export function MagicLinkForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(requestMagicLink, {});

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <Label htmlFor="email">Work email</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@aactivatedrx.com"
        aria-invalid={Boolean(state.error)}
        aria-describedby={state.error ? "email-error" : undefined}
      />
      {state.error && (
        <p id="email-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1">
        <Mail aria-hidden />
        {pending ? "Sending link" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
