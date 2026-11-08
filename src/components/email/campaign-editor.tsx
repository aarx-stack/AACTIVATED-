"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { draftWithAIAction, saveCampaignAction } from "@/app/(app)/content/email/actions";
import { ActionForm, selectClass, textareaClass } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Initial {
  id?: string;
  name: string;
  audience: string;
  subject: string;
  body: string;
}

/** Write or edit a campaign. "Draft with AI" fills the subject and body for the person to edit. */
export function CampaignEditor({
  audiences,
  initial,
}: {
  audiences: { value: string; label: string }[];
  initial: Initial;
}) {
  const [name, setName] = useState(initial.name);
  const [audience, setAudience] = useState(initial.audience || audiences[0]?.value || "");
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [brief, setBrief] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 tile p-4" aria-label="Draft with AI">
        <Label htmlFor="email-brief">Draft with AI (optional)</Label>
        <textarea
          id="email-brief"
          className={textareaClass}
          rows={2}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="For example: invite clinics to the December product webinar and explain how to register."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={drafting || brief.trim().length < 10}
            onClick={() =>
              startDraft(async () => {
                const result = await draftWithAIAction({ brief, audience });
                if (result.ok) {
                  setSubject(result.subject);
                  setBody(result.body);
                  setAiError(null);
                } else setAiError(result.error);
              })
            }
          >
            <Sparkles aria-hidden /> {drafting ? "Writing…" : "Draft with AI"}
          </Button>
          <span className="text-xs text-muted-foreground">
            The draft fills the fields below for you to edit. Nothing is sent.
          </span>
        </div>
        {aiError && (
          <p role="alert" className="text-xs text-danger">
            {aiError}
          </p>
        )}
      </section>

      <ActionForm action={saveCampaignAction} submitLabel="Save draft" testId="campaign-editor">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input
              id="campaign-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={3}
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-audience">Send to</Label>
            <select
              id="campaign-audience"
              name="audience"
              className={selectClass}
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              {audiences.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-subject">Subject</Label>
          <Input
            id="campaign-subject"
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            minLength={5}
            maxLength={120}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-body">Email</Label>
          <textarea
            id="campaign-body"
            name="body"
            className={textareaClass}
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={40}
            maxLength={8000}
          />
          <p className="text-xs text-muted-foreground">
            Plain text; leave a blank line between paragraphs. An unsubscribe line is added
            automatically.
          </p>
        </div>
      </ActionForm>
    </div>
  );
}
