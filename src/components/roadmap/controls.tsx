"use client";

import {
  addIdeaAction,
  addToMapAction,
  advanceAction,
  progressAction,
} from "@/app/(app)/roadmap/actions";
import { ActionForm, textareaClass } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AdvanceMode = "advance" | "request" | "decide";

/** The move control on a project's current card. */
export function AdvanceControl({
  projectId,
  mode,
  toLabel,
  tokenization,
}: {
  projectId: string;
  mode: AdvanceMode;
  toLabel: string;
  tokenization: boolean;
}) {
  if (mode === "advance") {
    return (
      <ActionForm
        action={advanceAction}
        submitLabel={`Move to ${toLabel}`}
        buttonVariant="secondary"
        className="gap-1"
      >
        <input type="hidden" name="projectId" value={projectId} />
      </ActionForm>
    );
  }
  if (mode === "request") {
    return (
      <details className="text-sm [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer font-semibold text-primary">
          Request approval to move to {toLabel}
        </summary>
        <ActionForm
          action={advanceAction}
          submitLabel="Send for approval"
          buttonVariant="secondary"
          className="mt-2 gap-2"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Label htmlFor={`req-${projectId}`} className="text-xs">
            Why is it ready? (optional)
          </Label>
          <textarea id={`req-${projectId}`} name="note" rows={2} className={textareaClass} />
        </ActionForm>
      </details>
    );
  }
  return (
    <details className="text-sm [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer font-semibold text-warning">
        Approve the move to {toLabel}
      </summary>
      <ActionForm
        action={advanceAction}
        submitLabel={`Approve and move to ${toLabel}`}
        className="mt-2 gap-2"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <Label htmlFor={`dec-${projectId}`} className="text-xs">
          {tokenization
            ? "Decision note, including the legal review (required)"
            : "Decision note (required)"}
        </Label>
        <textarea
          id={`dec-${projectId}`}
          name="note"
          rows={2}
          required
          minLength={10}
          className={textareaClass}
        />
      </ActionForm>
    </details>
  );
}

export function ProgressControl({ projectId, value }: { projectId: string; value: number }) {
  return (
    <details className="text-xs [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Update progress
      </summary>
      <ActionForm
        action={progressAction}
        submitLabel="Save"
        buttonVariant="secondary"
        className="mt-2 flex-row items-end gap-2"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <div className="flex flex-col gap-1">
          <Label htmlFor={`prog-${projectId}`} className="text-xs">
            Progress (%)
          </Label>
          <Input
            id={`prog-${projectId}`}
            name="progress"
            type="number"
            min={0}
            max={100}
            defaultValue={value}
            className="w-24"
          />
        </div>
      </ActionForm>
    </details>
  );
}

export function AddToMapButton({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={addToMapAction} submitLabel="Add to Map" className="shrink-0 gap-1">
      <input type="hidden" name="projectId" value={projectId} />
    </ActionForm>
  );
}

export function AddIdeaForm() {
  return (
    <ActionForm
      action={addIdeaAction}
      submitLabel="Add idea"
      buttonVariant="secondary"
      resetOnSuccess
      testId="add-idea"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="idea-name">Idea</Label>
        <Input id="idea-name" name="name" required minLength={3} maxLength={80} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="idea-description">In one sentence</Label>
        <Input id="idea-description" name="description" required minLength={5} maxLength={200} />
      </div>
    </ActionForm>
  );
}
