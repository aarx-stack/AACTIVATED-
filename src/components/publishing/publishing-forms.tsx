"use client";

import { ArrowDown, ArrowUp, Sparkles, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import {
  addSectionAction,
  createPublicationAction,
  deleteSectionAction,
  moveSectionAction,
  submitPublicationAction,
  updateSectionAction,
  writeSectionAction,
} from "@/app/(app)/content/publishing/actions";
import { ActionForm, selectClass, textareaClass } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewPublicationForm() {
  const [outline, setOutline] = useState(true);
  return (
    <ActionForm
      action={createPublicationAction}
      submitLabel={outline ? "Create and outline with AI" : "Create"}
      pendingLabel={outline ? "The Publishing team is outlining…" : "Creating…"}
      testId="new-publication"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pub-title">Title</Label>
          <Input id="pub-title" name="title" required minLength={3} maxLength={160} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pub-kind">Type</Label>
          <select id="pub-kind" name="kind" className={selectClass} defaultValue="EBOOK">
            <option value="ARTICLE">Article</option>
            <option value="EBOOK">E-book</option>
            <option value="BOOK">Book</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pub-subtitle">Subtitle (optional)</Label>
        <Input id="pub-subtitle" name="subtitle" maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pub-audience">Who it is for</Label>
        <Input
          id="pub-audience"
          name="audience"
          required
          minLength={3}
          maxLength={120}
          placeholder="For example: new members, clinic staff, reps"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pub-description">What it is about</Label>
        <textarea
          id="pub-description"
          name="description"
          className={textareaClass}
          rows={4}
          required
          minLength={10}
          maxLength={2000}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 tile p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="outlineWithAI"
            checked={outline}
            onChange={(e) => setOutline(e.target.checked)}
          />
          Outline it with AI
        </label>
        {outline && (
          <label className="flex items-center gap-2 text-sm">
            Parts
            <input
              type="number"
              name="sectionCount"
              min={1}
              max={30}
              defaultValue={6}
              aria-label="Number of chapters or sections"
              className="h-9 w-20 rounded-control border border-border bg-transparent px-2"
            />
          </label>
        )}
      </div>
    </ActionForm>
  );
}

export function AddSectionForm({ publicationId, label }: { publicationId: string; label: string }) {
  return (
    <ActionForm
      action={addSectionAction}
      submitLabel={`Add ${label}`}
      buttonVariant="secondary"
      testId="add-section"
      resetOnSuccess
    >
      <input type="hidden" name="publicationId" value={publicationId} />
      <Label htmlFor="new-section" className="sr-only">
        New {label} title
      </Label>
      <Input
        id="new-section"
        name="title"
        placeholder={`New ${label} title`}
        required
        minLength={2}
      />
    </ActionForm>
  );
}

export function MoveButtons({
  sectionId,
  first,
  last,
}: {
  sectionId: string;
  first: boolean;
  last: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <span className="flex shrink-0 gap-1">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={pending || first}
        aria-label="Move up"
        onClick={() => start(() => moveSectionAction(sectionId, "up"))}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={pending || last}
        aria-label="Move down"
        onClick={() => start(() => moveSectionAction(sectionId, "down"))}
      >
        <ArrowDown aria-hidden />
      </Button>
    </span>
  );
}

export function SectionEditor({
  section,
  label,
  locked,
}: {
  section: { id: string; title: string; summary: string; body: string; writtenBy: string | null };
  label: string;
  locked: boolean;
}) {
  const [title, setTitle] = useState(section.title);
  const [summary, setSummary] = useState(section.summary);
  const [body, setBody] = useState(section.body);
  const [note, setNote] = useState("");
  const [writtenBy, setWrittenBy] = useState(section.writtenBy);
  const [aiError, setAiError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();
  const [deleting, startDelete] = useTransition();
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 tile p-4" aria-label="Write with AI">
        <Label htmlFor="ai-note">Write this {label} with AI</Label>
        <Input
          id="ai-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the writer, e.g. add a short checklist at the end"
          disabled={locked}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={locked || writing}
            onClick={() => {
              if (body.trim() && !window.confirm(`Replace the current text of this ${label}?`))
                return;
              startWriting(async () => {
                const result = await writeSectionAction(section.id, note);
                if (result.ok) {
                  setBody(result.body);
                  setWrittenBy(result.writtenBy);
                  setAiError(null);
                } else setAiError(result.error);
              });
            }}
          >
            <Sparkles aria-hidden />{" "}
            {writing ? "Writing…" : body.trim() ? "Rewrite with AI" : "Write with AI"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {writtenBy
              ? `Current text by ${writtenBy === "person" ? "a person" : writtenBy}. `
              : ""}
            Internal draft until approved.
          </span>
        </div>
        {aiError && (
          <p role="alert" className="text-xs text-danger">
            {aiError}
          </p>
        )}
      </section>

      <ActionForm
        action={updateSectionAction}
        submitLabel={`Save ${label}`}
        testId="section-editor"
      >
        <input type="hidden" name="sectionId" value={section.id} />
        <fieldset disabled={locked} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-title">Title</Label>
            <Input
              id="section-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-summary">What it covers</Label>
            <Input
              id="section-summary"
              name="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={400}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-body">Text</Label>
            <textarea
              id="section-body"
              name="body"
              className={textareaClass}
              rows={18}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {words.toLocaleString("en-US")} words. Leave a blank line between paragraphs.
            </p>
          </div>
        </fieldset>
      </ActionForm>
      {!locked && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={deleting}
            onClick={() => {
              if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
              startDelete(() => deleteSectionAction(section.id));
            }}
          >
            <Trash2 aria-hidden /> Delete {label}
          </Button>
        </div>
      )}
    </div>
  );
}

export function SubmitPublicationButton({ publicationId }: { publicationId: string }) {
  return (
    <ActionForm
      action={submitPublicationAction}
      submitLabel="Send for approval"
      pendingLabel="Checking and submitting…"
      testId="submit-publication"
    >
      <input type="hidden" name="publicationId" value={publicationId} />
    </ActionForm>
  );
}
