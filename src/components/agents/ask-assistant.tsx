"use client";

import { askAssistantAction } from "@/app/(app)/agents/actions";
import { ActionForm, textareaClass } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The owner gives their personal assistant a request. */
export function AskAssistant({ agentId }: { agentId: string }) {
  return (
    <ActionForm
      action={askAssistantAction}
      submitLabel="Send to my assistant"
      pendingLabel="Working…"
      testId="ask-assistant"
      resetOnSuccess
    >
      <input type="hidden" name="agentId" value={agentId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assistant-title">Request</Label>
        <Input
          id="assistant-title"
          name="title"
          required
          minLength={3}
          maxLength={120}
          placeholder="For example: Prepare my Monday briefing"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assistant-instructions">Details</Label>
        <textarea
          id="assistant-instructions"
          name="instructions"
          className={textareaClass}
          rows={4}
          required
          minLength={10}
          maxLength={4000}
          placeholder="What you need, for whom, and anything it should include."
        />
      </div>
    </ActionForm>
  );
}
