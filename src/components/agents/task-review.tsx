"use client";

import { useState, useTransition } from "react";
import { markTaskDoneAction, retryTaskAction } from "@/app/(app)/agents/actions";
import { Button } from "@/components/ui/button";

interface Draft {
  summary: string;
  deliverable: string;
  nextSteps: string[];
}

/** The agent's draft for a prompt task, and what a person can do with it. */
export function TaskReview({
  taskId,
  title,
  status,
  draft,
  lastError,
  canAct,
}: {
  taskId: string;
  title: string;
  status: string;
  draft: Draft | null;
  lastError: string | null;
  canAct: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const result = await fn();
      setMessage(
        result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error },
      );
    });

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {status === "BLOCKED" && lastError && (
        <p className="text-xs text-danger" data-testid="task-error">
          {lastError}
        </p>
      )}
      {draft && (
        <details className="group text-xs" data-testid="task-draft">
          <summary className="cursor-pointer font-medium text-primary">View draft</summary>
          <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-border p-2.5">
            <p className="text-muted-foreground">{draft.summary}</p>
            <p className="leading-relaxed break-words whitespace-pre-wrap">{draft.deliverable}</p>
            {draft.nextSteps.length > 0 && (
              <div>
                <p className="font-semibold">Next steps</p>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {draft.nextSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
      {canAct && status === "IN_REVIEW" && draft && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            aria-label={`Mark "${title}" done`}
            onClick={() => run(() => markTaskDoneAction(taskId))}
          >
            Mark done
          </Button>
        </div>
      )}
      {canAct && status === "BLOCKED" && lastError && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            aria-label={`Try "${title}" again`}
            onClick={() => run(() => retryTaskAction(taskId))}
          >
            {pending ? "Working…" : "Try again"}
          </Button>
        </div>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className="text-xs text-muted-foreground">
          {message.text}
        </p>
      )}
    </div>
  );
}
