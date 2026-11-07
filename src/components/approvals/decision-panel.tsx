"use client";

import { Check, PencilLine, X } from "lucide-react";
import { useActionState, useState } from "react";
import { decideAction, editAction, type ApprovalActionState } from "@/app/(app)/approvals/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  id: string;
  canDecide: boolean;
  decideBlockedReason?: string;
  canEdit: boolean;
  complianceFailed: boolean;
  draft?: { title: string; caption: string; hashtags: string[] };
}

function Feedback({ state }: { state: ApprovalActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={state.status === "error" ? "text-sm text-danger" : "text-sm text-success"}
    >
      {state.message}
    </p>
  );
}

export function DecisionPanel({
  id,
  canDecide,
  decideBlockedReason,
  canEdit,
  complianceFailed,
  draft,
}: Props) {
  const [decideState, decide, deciding] = useActionState<ApprovalActionState, FormData>(
    decideAction,
    { status: "idle" },
  );
  const [editState, edit, saving] = useActionState<ApprovalActionState, FormData>(editAction, {
    status: "idle",
  });
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-4" data-testid="decision-panel">
      {canDecide ? (
        <form action={decide} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={id} />
          <Label htmlFor="decision-note">
            Decision note{" "}
            {complianceFailed
              ? "(required to approve: acknowledge the findings)"
              : "(required to reject)"}
          </Label>
          <textarea
            id="decision-note"
            name="note"
            rows={3}
            maxLength={1000}
            className="w-full rounded-control border border-border bg-surface-solid px-3 py-2 text-sm placeholder:text-subtle-foreground focus-visible:border-border-strong"
            placeholder={
              complianceFailed
                ? "Why is it acceptable to publish despite the findings?"
                : "Optional for approval"
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="APPROVE" disabled={deciding}>
              <Check aria-hidden /> Approve
            </Button>
            {canEdit && draft && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing((v) => !v)}
                aria-expanded={editing}
              >
                <PencilLine aria-hidden /> Edit
              </Button>
            )}
            <Button
              type="submit"
              name="decision"
              value="REJECT"
              variant="danger"
              disabled={deciding}
            >
              <X aria-hidden /> Reject
            </Button>
          </div>
          <Feedback state={decideState} />
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
            {decideBlockedReason}
          </p>
          {canEdit && draft && (
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
            >
              <PencilLine aria-hidden /> Edit
            </Button>
          )}
        </div>
      )}

      {editing && draft && (
        <form
          action={edit}
          className="flex flex-col gap-3 rounded-control border border-border bg-surface-muted p-4"
        >
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-muted-foreground">
            Saving creates a new revision and re-runs the compliance check. The decision is made
            separately.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" name="title" defaultValue={draft.title} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-caption">Caption</Label>
            <textarea
              id="edit-caption"
              name="caption"
              rows={8}
              defaultValue={draft.caption}
              required
              className="w-full rounded-control border border-border bg-surface-solid px-3 py-2 text-sm focus-visible:border-border-strong"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-hashtags">Hashtags</Label>
            <Input id="edit-hashtags" name="hashtags" defaultValue={draft.hashtags.join(" ")} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              Save and re-check
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <Feedback state={editState} />
        </form>
      )}
    </div>
  );
}
