"use client";

import { Sparkles } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import {
  rewriteAction,
  submitDraftAction,
  updateDraftAction,
  type RewriteState,
} from "@/app/(app)/content/actions";
import { ActionFeedback, selectClass, textareaClass } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/server/action-result";

interface Draft {
  id: string;
  title: string;
  caption: string;
  hashtags: string[];
  channel: string;
  plannedFor: string;
}

/** Edit a draft, ask the writer agent for alternatives, then send it for review. */
export function CaptionEditor({ draft }: { draft: Draft }) {
  const [caption, setCaption] = useState(draft.caption);
  const [saveState, save, saving] = useActionState<ActionState, FormData>(updateDraftAction, {
    status: "idle",
  });
  const [submitState, submit, submitting] = useActionState<ActionState, FormData>(
    submitDraftAction,
    {
      status: "idle",
    },
  );
  const [rewriteState, rewrite, rewriting] = useActionState<RewriteState, FormData>(rewriteAction, {
    status: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-5">
      <form
        ref={formRef}
        action={save}
        className="grid gap-3 md:grid-cols-2"
        data-testid="caption-editor"
      >
        <input type="hidden" name="id" value={draft.id} />
        <div className="grid gap-1.5 md:col-span-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={draft.title} required />
        </div>
        <div className="grid gap-1.5 md:col-span-2">
          <Label htmlFor="caption">Caption</Label>
          <textarea
            id="caption"
            name="caption"
            rows={8}
            required
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className={textareaClass}
          />
          <p className="text-xs text-subtle-foreground tabular-nums">{caption.length} / 2200</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hashtags">Hashtags</Label>
          <Input id="hashtags" name="hashtags" defaultValue={draft.hashtags.join(" ")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="channel">Channel</Label>
          <select id="channel" name="channel" defaultValue={draft.channel} className={selectClass}>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK">Facebook</option>
            <option value="TIKTOK">TikTok</option>
            <option value="YOUTUBE">YouTube</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plannedFor">Planned date</Label>
          <Input id="plannedFor" name="plannedFor" type="date" defaultValue={draft.plannedFor} />
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={saving}>
            {saving ? "Saving…" : "Save draft"}
          </Button>
        </div>
        <div className="md:col-span-2" aria-live="polite">
          <ActionFeedback state={saveState} />
        </div>
      </form>

      <section
        aria-label="AI caption suggestions"
        className="rounded-card border border-border bg-surface-muted p-4"
      >
        <form action={rewrite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={draft.id} />
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="instruction">Ask the writer agent for alternatives</Label>
            <Input
              id="instruction"
              name="instruction"
              placeholder="Optional direction, e.g. make it shorter"
              maxLength={200}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={rewriting}>
            <Sparkles aria-hidden /> {rewriting ? "Thinking…" : "Suggest captions"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-subtle-foreground">
          Suggestions use the last saved caption. Save first if you changed it.
        </p>
        <div aria-live="polite">
          {rewriteState.status === "error" && (
            <p className="mt-3 text-sm text-danger">{rewriteState.message}</p>
          )}
          {rewriteState.status === "done" && (
            <ul className="mt-3 grid gap-3 md:grid-cols-3" data-testid="suggestions">
              {rewriteState.variants.map((v) => (
                <li
                  key={v.label}
                  className="flex flex-col gap-2 rounded-control border border-border bg-surface-solid p-3 text-sm"
                >
                  <p className="font-medium">{v.label}</p>
                  <p className="flex-1 whitespace-pre-line text-muted-foreground">{v.caption}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() => setCaption(v.caption)}
                  >
                    Use this
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <form
        action={submit}
        className="flex flex-col gap-3 rounded-card border border-border-strong p-4"
      >
        <input type="hidden" name="id" value={draft.id} />
        <Label htmlFor="why">Why this post? (shown to the reviewer)</Label>
        <textarea id="why" name="why" rows={2} maxLength={600} className={textareaClass} />
        <p className="text-xs text-muted-foreground">
          Sending runs the compliance check on the last saved version and puts the post in the
          Approval Queue. You cannot approve your own post.
        </p>
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Checking…" : "Send for review"}
        </Button>
        <div aria-live="polite">
          <ActionFeedback state={submitState} />
        </div>
      </form>
    </div>
  );
}
