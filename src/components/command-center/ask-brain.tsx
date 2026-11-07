"use client";

import { SendHorizontal, Sparkles } from "lucide-react";
import { useActionState } from "react";
import { askBrain, type AskBrainState } from "@/app/(app)/command-center/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatUsd } from "@/lib/utils";

export function AskBrain({ enabled }: { enabled: boolean }) {
  const [state, formAction, pending] = useActionState<AskBrainState, FormData>(askBrain, {
    status: "idle",
  });

  return (
    <Card className="rounded-[22px] p-2.5">
      <form
        action={formAction}
        className="flex items-center gap-3 tile rounded-pill py-1 pr-1 pl-4"
        role="search"
        aria-label="Ask the Brain"
      >
        <Sparkles className="size-5 shrink-0 text-cyan" aria-hidden />
        <label htmlFor="ask-brain" className="sr-only">
          Ask the Brain
        </label>
        <input
          id="ask-brain"
          name="question"
          autoComplete="off"
          disabled={!enabled || pending}
          placeholder={
            enabled ? "Ask the Brain…" : "Ask the Brain is available to executives and staff"
          }
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          maxLength={1000}
        />
        <Button
          type="submit"
          size="icon"
          className="size-11 rounded-pill"
          disabled={!enabled || pending}
          aria-label="Send question"
        >
          <SendHorizontal aria-hidden />
        </Button>
      </form>
      <div aria-live="polite">
        {pending && <p className="px-3 pt-2 pb-1 text-sm text-muted-foreground">Thinking…</p>}
        {!pending && state.status === "error" && (
          <p role="alert" className="px-3 pt-2 pb-1 text-sm text-danger">
            {state.message}
          </p>
        )}
        {!pending && state.status === "answered" && (
          <div className="mt-2 rounded-control border border-border bg-surface-muted p-4">
            <p className="text-xs font-medium text-muted-foreground">You asked: {state.question}</p>
            <p className="mt-2 text-sm whitespace-pre-line">{state.answer}</p>
            <p className="mt-3 text-xs text-subtle-foreground tabular-nums">
              {state.provider === "mock" ? "Mock model" : "Claude"} · cost{" "}
              {formatUsd(state.costUsd)} · logged to AI spend
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
