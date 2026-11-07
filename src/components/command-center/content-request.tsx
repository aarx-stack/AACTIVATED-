"use client";

import { ArrowRight, CircleCheck, CircleX, Send } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { requestContent, type ContentRequestState } from "@/app/(app)/command-center/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const STEPS = [
  "The Brain plans the work",
  "The Operations Manager delegates it",
  "The Content Specialist drafts it",
  "Automated compliance check",
  "Sent to the Approval Queue for a human decision",
];

const selectClass =
  "h-10 w-full rounded-control border border-border bg-surface-solid px-3 text-sm text-foreground focus-visible:border-border-strong";

export function ContentRequest() {
  const [state, action, pending] = useActionState<ContentRequestState, FormData>(requestContent, {
    status: "idle",
  });

  return (
    <Card data-testid="content-request">
      <CardHeader className="flex-col items-stretch">
        <CardTitle>Give the Brain a task</CardTitle>
        <CardDescription>
          Request a social post. Agents plan, draft and check it; nothing is published until a human
          approves.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={action} className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="brief">What should we post?</Label>
            <textarea
              id="brief"
              name="brief"
              required
              minLength={15}
              maxLength={1000}
              rows={3}
              placeholder="e.g. An educational post about building a consistent Recovery Stack routine."
              className="w-full rounded-control border border-border bg-surface-solid px-3 py-2 text-sm placeholder:text-subtle-foreground focus-visible:border-border-strong"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="channel">Channel</Label>
            <select id="channel" name="channel" defaultValue="INSTAGRAM" className={selectClass}>
              <option value="INSTAGRAM">Instagram</option>
              <option value="FACEBOOK">Facebook</option>
              <option value="TIKTOK">TikTok</option>
              <option value="YOUTUBE">YouTube</option>
            </select>
          </div>
          <Button type="submit" disabled={pending} className="self-end">
            <Send aria-hidden /> {pending ? "Agents working…" : "Send to the Brain"}
          </Button>
        </form>

        <div aria-live="polite">
          {state.status === "error" && (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          )}
          {state.status === "queued" && (
            <p className="text-sm text-muted-foreground">
              Queued. The background worker is running the agents; the draft will appear in the
              Approval Queue.
            </p>
          )}
          {(state.status === "submitted" || state.status === "blocked") && (
            <div
              className="rounded-control border border-border bg-surface-muted p-4"
              data-testid="workflow-result"
            >
              <ol className="flex flex-col gap-2 text-sm">
                {STEPS.map((step, i) => {
                  const done = state.status === "submitted";
                  return (
                    <li key={step} className="flex items-center gap-2">
                      {done ? (
                        <CircleCheck className="size-4 shrink-0 text-success" aria-label="Done" />
                      ) : (
                        <CircleX
                          className="size-4 shrink-0 text-danger"
                          aria-label="Not completed"
                        />
                      )}
                      <span className={done ? undefined : "text-muted-foreground"}>
                        {i + 1}. {step}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {state.status === "submitted" && state.compliance && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      state.compliance.outcome === "PASS"
                        ? "success"
                        : state.compliance.outcome === "WARN"
                          ? "warning"
                          : "danger"
                    }
                  >
                    Compliance {state.compliance.outcome.toLowerCase()}
                  </Badge>
                  {state.compliance.violations > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {state.compliance.violations} finding
                      {state.compliance.violations === 1 ? "" : "s"} flagged for review
                    </span>
                  )}
                  {state.approvalId && (
                    <Button asChild size="sm" variant="secondary" className="ml-auto">
                      <Link href={`/approvals/${state.approvalId}`}>
                        Open in Approval Queue <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                  )}
                </div>
              )}
              {state.status === "blocked" && (
                <p className="mt-3 text-sm text-danger">{state.error}</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
