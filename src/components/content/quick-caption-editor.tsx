"use client";

import { Check, Copy, RefreshCw, X } from "lucide-react";
import { useActionState, useState } from "react";
import { rewriteAction, updateDraftAction, type RewriteState } from "@/app/(app)/content/actions";
import { ActionFeedback, textareaClass } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/server/action-result";

/**
 * The Content Studio side panel: ask the writer agent for a caption, tweak it,
 * then apply it to the draft. Nothing is published from here; the draft still
 * goes through compliance and approval.
 */
export function QuickCaptionEditor({
  post,
}: {
  post: {
    id: string;
    title: string;
    caption: string;
    hashtags: string[];
    channel: string;
    plannedFor: string;
  };
}) {
  const [caption, setCaption] = useState(post.caption);
  const [tags, setTags] = useState(post.hashtags);
  const [variant, setVariant] = useState(0);
  const [copied, setCopied] = useState(false);
  const [rewriteState, rewrite, rewriting] = useActionState<RewriteState, FormData>(
    async (prev, fd) => {
      const result = await rewriteAction(prev, fd);
      if (result.status === "done" && result.variants[0]) {
        setVariant(0);
        setCaption(result.variants[0].caption);
      }
      return result;
    },
    { status: "idle" },
  );
  const [applyState, apply, applying] = useActionState<ActionState, FormData>(updateDraftAction, {
    status: "idle",
  });
  const variants = rewriteState.status === "done" ? rewriteState.variants : [];

  return (
    <div className="flex flex-col gap-4" data-testid="ai-caption-editor">
      <form action={rewrite} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={post.id} />
        <Label htmlFor="caption-prompt">Caption prompt (optional)</Label>
        <textarea
          id="caption-prompt"
          name="instruction"
          rows={2}
          maxLength={200}
          placeholder="e.g. Make it warmer and end with a question"
          className={textareaClass}
        />
        <div className="flex items-center justify-between">
          <Label htmlFor="ai-caption">AI-Generated Caption</Label>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={rewriting}
            className="text-cyan"
          >
            <RefreshCw className={rewriting ? "animate-spin" : undefined} aria-hidden />{" "}
            {rewriting ? "Writing…" : "Regenerate"}
          </Button>
        </div>
      </form>
      <textarea
        id="ai-caption"
        rows={7}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        className={`${textareaClass} border-[var(--border-strong)] shadow-glow-soft`}
      />
      {variants.length > 1 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
          {variants.map((v, i) => (
            <button
              key={v.label}
              type="button"
              onClick={() => {
                setVariant(i);
                setCaption(v.caption);
              }}
              aria-pressed={variant === i}
              className={`rounded-pill border px-3 py-1 text-xs font-semibold ${variant === i ? "border-transparent fill-primary" : "border-border text-muted-foreground"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      {rewriteState.status === "error" && (
        <p className="text-sm text-danger">{rewriteState.message}</p>
      )}

      <div>
        <p className="mb-2 text-sm font-medium">Hashtags</p>
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t}>
              <span className="inline-flex items-center gap-1 tile rounded-pill px-2.5 py-1 text-xs font-semibold">
                {t}
                <button
                  type="button"
                  aria-label={`Remove ${t}`}
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
          {tags.length === 0 && <li className="text-xs text-muted-foreground">No hashtags.</li>}
        </ul>
      </div>

      <form action={apply} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={post.id} />
        <input type="hidden" name="title" value={post.title} />
        <input type="hidden" name="caption" value={caption} />
        <input type="hidden" name="hashtags" value={tags.join(" ")} />
        <input type="hidden" name="channel" value={post.channel} />
        <input type="hidden" name="plannedFor" value={post.plannedFor} />
        <div className="grid grid-cols-2 gap-2">
          <Button type="submit" disabled={applying} className="rounded-control">
            <Check aria-hidden /> {applying ? "Applying…" : "Apply to Post"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard?.writeText(caption);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy aria-hidden /> {copied ? "Copied" : "Copy Caption"}
          </Button>
        </div>
        <div aria-live="polite">
          <ActionFeedback state={applyState} />
        </div>
      </form>
    </div>
  );
}
