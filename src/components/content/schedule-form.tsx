"use client";

import { CalendarClock } from "lucide-react";
import { useActionState, useState } from "react";
import { scheduleAction } from "@/app/(app)/content/actions";
import { ActionFeedback } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/server/action-result";

function defaultSlot() {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(scheduleAction, {
    status: "idle",
  });
  const [offset] = useState(() => new Date().getTimezoneOffset());
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="schedule-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tzOffset" value={offset} />
      <Label htmlFor="at">Publish at (your time)</Label>
      <Input
        id="at"
        name="at"
        type="datetime-local"
        required
        defaultValue={defaultSlot()}
        className="max-w-64"
      />
      <p className="text-xs text-muted-foreground">
        The approved version is sent to GoHighLevel exactly as approved. If it changed, the gate
        blocks it.
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        <CalendarClock aria-hidden /> {pending ? "Scheduling…" : "Schedule post"}
      </Button>
      <div aria-live="polite">
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}
