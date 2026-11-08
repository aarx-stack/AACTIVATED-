"use client";

import { useState, useTransition } from "react";
import {
  addTradelineAction,
  recordScoreAction,
  setTradelineStatusAction,
  updateMilestoneAction,
} from "@/app/(app)/finance/credit/actions";
import { ActionForm, selectClass } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STEP_STATUS = [
  ["NOT_STARTED", "Not started"],
  ["IN_PROGRESS", "In progress"],
  ["DONE", "Done"],
] as const;

export function MilestoneForm({
  id,
  title,
  status,
  notes,
}: {
  id: string;
  title: string;
  status: string;
  notes: string;
}) {
  const [value, setValue] = useState(status);
  const [text, setText] = useState(notes);
  return (
    <ActionForm
      action={updateMilestoneAction}
      submitLabel="Save"
      buttonVariant="secondary"
      className="gap-2"
      testId={`step-${id}`}
    >
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
        <select
          name="status"
          aria-label={`Status: ${title}`}
          className={selectClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          {STEP_STATUS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Input
          name="notes"
          aria-label={`Notes: ${title}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Notes (no account numbers or EIN)"
          maxLength={2000}
        />
      </div>
    </ActionForm>
  );
}

export function TradelineStatusSelect({
  id,
  vendor,
  status,
}: {
  id: string;
  vendor: string;
  status: string;
}) {
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  return (
    <select
      aria-label={`Status of ${vendor}`}
      className={selectClass}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        start(() => setTradelineStatusAction(id, next));
      }}
    >
      <option value="APPLIED">Applied</option>
      <option value="OPEN">Open</option>
      <option value="CLOSED">Closed</option>
      <option value="DECLINED">Declined</option>
    </select>
  );
}

export function TradelineForm({
  kinds,
  bureaus,
}: {
  kinds: [string, string][];
  bureaus: readonly string[];
}) {
  return (
    <ActionForm
      action={addTradelineAction}
      submitLabel="Add account"
      testId="add-tradeline"
      resetOnSuccess
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tl-vendor">With</Label>
          <Input
            id="tl-vendor"
            name="vendor"
            required
            minLength={2}
            maxLength={120}
            placeholder="Vendor, card or lender"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tl-kind">Type</Label>
          <select id="tl-kind" name="kind" className={selectClass} defaultValue="VENDOR_NET30">
            {kinds.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tl-limit">Limit (USD, optional)</Label>
          <Input
            id="tl-limit"
            name="limitUsd"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tl-status">Status</Label>
          <select id="tl-status" name="status" className={selectClass} defaultValue="APPLIED">
            <option value="APPLIED">Applied</option>
            <option value="OPEN">Open</option>
          </select>
        </div>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-sm font-medium">Reports to</legend>
        {bureaus.map((b) => (
          <label key={b} className="flex items-center gap-2">
            <input type="checkbox" name="reportsTo" value={b} /> {b}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tl-notes">Notes (optional)</Label>
        <Input
          id="tl-notes"
          name="notes"
          maxLength={1000}
          placeholder="Terms, payment date. No account numbers."
        />
      </div>
    </ActionForm>
  );
}

export function ScoreForm({
  bureaus,
}: {
  bureaus: { value: string; label: string; range: string }[];
}) {
  const [bureau, setBureau] = useState(bureaus[0]?.value ?? "");
  const range = bureaus.find((b) => b.value === bureau)?.range ?? "";
  return (
    <ActionForm
      action={recordScoreAction}
      submitLabel="Record score"
      testId="record-score"
      resetOnSuccess
    >
      <div className="grid gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sc-bureau">Score</Label>
          <select
            id="sc-bureau"
            name="bureau"
            className={selectClass}
            value={bureau}
            onChange={(e) => setBureau(e.target.value)}
          >
            {bureaus.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sc-value">Value ({range})</Label>
          <Input id="sc-value" name="score" type="number" required inputMode="numeric" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sc-date">Date on the report</Label>
          <Input id="sc-date" name="recordedAt" type="date" />
        </div>
      </div>
    </ActionForm>
  );
}
