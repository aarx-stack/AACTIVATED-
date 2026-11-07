"use client";

import { Plus } from "lucide-react";
import { useActionState, useTransition, useState } from "react";
import {
  createRuleAction,
  toggleRuleAction,
  type ApprovalActionState,
} from "@/app/(app)/approvals/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass =
  "h-10 w-full rounded-control border border-border bg-surface-solid px-3 text-sm text-foreground focus-visible:border-border-strong";

export function RuleToggle({ id, active, label }: { id: string; active: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <Button
        size="sm"
        variant={active ? "ghost" : "secondary"}
        disabled={pending}
        aria-label={`${active ? "Disable" : "Enable"} rule: ${label}`}
        onClick={() =>
          start(async () => {
            const result = await toggleRuleAction(id, !active);
            setError(result.status === "error" ? result.message : null);
          })
        }
      >
        {active ? "Disable" : "Enable"}
      </Button>
    </span>
  );
}

export function RuleForm() {
  const [state, action, pending] = useActionState<ApprovalActionState, FormData>(createRuleAction, {
    status: "idle",
  });
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor="rule-type">Type</Label>
        <select id="rule-type" name="type" className={selectClass} defaultValue="BLOCKLIST_TERM">
          <option value="BLOCKLIST_TERM">Blocklisted word</option>
          <option value="PEPTIDE_NAME">Peptide name (use stack name)</option>
          <option value="MEDICAL_CLAIM">Medical or health claim</option>
          <option value="PLATFORM_RULE">Platform rule</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rule-severity">Severity</Label>
        <select id="rule-severity" name="severity" className={selectClass} defaultValue="HIGH">
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium (staff can approve)</option>
          <option value="HIGH">High (executive decision)</option>
          <option value="CRITICAL">Critical (executive decision)</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rule-pattern">Term or pattern</Label>
        <Input id="rule-pattern" name="pattern" required placeholder="e.g. miracle" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="isRegex" className="size-4 accent-[var(--primary)]" /> Treat
          as a regular expression
        </label>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">Channels (none = all)</legend>
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          {["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "EMAIL"].map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="channels"
                value={c}
                className="size-4 accent-[var(--primary)]"
              />
              {c.charAt(0) + c.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="rule-description">Why it is flagged</Label>
        <Input id="rule-description" name="description" required placeholder="Shown to reviewers" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rule-suggestion">Suggested fix (optional)</Label>
        <Input
          id="rule-suggestion"
          name="suggestion"
          placeholder="e.g. Use the branded stack name"
        />
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          <Plus aria-hidden /> Add rule
        </Button>
        {state.status !== "idle" && (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={state.status === "error" ? "text-sm text-danger" : "text-sm text-success"}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
