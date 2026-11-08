"use client";

import { useState } from "react";
import { createDocumentAction, summarizeAction } from "@/app/(app)/knowledge/actions";
import { ActionForm, selectClass, textareaClass } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SummarizeButton({
  documentId,
  label = "Generate summary",
}: {
  documentId: string;
  label?: string;
}) {
  return (
    <ActionForm
      action={summarizeAction}
      submitLabel={label}
      pendingLabel="The Brain is reading…"
      buttonVariant="secondary"
      className="gap-1.5"
      testId="summarize"
    >
      <input type="hidden" name="documentId" value={documentId} />
    </ActionForm>
  );
}

const CATEGORIES = [
  ["POLICIES", "Policies"],
  ["TRAINING", "Training"],
  ["BRAND", "Brand"],
  ["PRODUCT_EDUCATION", "Product Education"],
  ["LEGAL_RESEARCH", "Legal Research (executive only)"],
] as const;

export function NewDocumentForm({ isExecutive }: { isExecutive: boolean }) {
  const [category, setCategory] = useState("POLICIES");
  const legal = category === "LEGAL_RESEARCH";
  return (
    <ActionForm
      action={createDocumentAction}
      submitLabel="Add document"
      pendingLabel="Adding and summarizing…"
      testId="new-document"
      resetOnSuccess
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doc-title">Title</Label>
        <Input id="doc-title" name="title" required minLength={3} maxLength={140} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-category">Category</Label>
          <select
            id="doc-category"
            name="category"
            className={selectClass}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.filter(([value]) => isExecutive || value !== "LEGAL_RESEARCH").map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-access">Who can read it</Label>
          <select
            id="doc-access"
            name="accessLevel"
            className={selectClass}
            defaultValue="ALL_STAFF"
            disabled={legal}
          >
            <option value="ALL_USERS">Everyone (staff and reps)</option>
            <option value="ALL_STAFF">All Staff</option>
            {isExecutive && <option value="EXECUTIVE_ONLY">Executive Only</option>}
          </select>
          {legal && (
            <>
              <input type="hidden" name="accessLevel" value="EXECUTIVE_ONLY" />
              <p className="text-xs text-muted-foreground">
                Legal research is always executive-only.
              </p>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doc-body">Document text</Label>
        <textarea
          id="doc-body"
          name="body"
          rows={10}
          required
          minLength={40}
          className={textareaClass}
          placeholder="Paste the document. Lines starting with - become bullet points."
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doc-tags">Tags (comma-separated, optional)</Label>
        <Input id="doc-tags" name="tags" placeholder="e.g. onboarding, reps" />
      </div>
    </ActionForm>
  );
}
