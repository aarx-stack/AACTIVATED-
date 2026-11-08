"use client";

import { requestLimitChangeAction } from "@/app/(app)/budgets/actions";
import { ActionForm, selectClass, textareaClass } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RequestChangeForm({ budgets }: { budgets: { id: string; name: string }[] }) {
  return (
    <ActionForm
      action={requestLimitChangeAction}
      submitLabel="Request change"
      pendingLabel="Sending…"
      testId="request-limit-change"
      resetOnSuccess
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="change-budget">Budget</Label>
          <select id="change-budget" name="budgetId" className={selectClass} required>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="change-limit">New limit (USD)</Label>
          <Input
            id="change-limit"
            name="limitUsd"
            type="number"
            min="1"
            step="0.01"
            inputMode="decimal"
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="change-reason">Why</Label>
        <textarea
          id="change-reason"
          name="reason"
          className={textareaClass}
          rows={3}
          required
          minLength={10}
          maxLength={500}
          placeholder="For example: two more campaign launches this month need more ad spend."
        />
      </div>
    </ActionForm>
  );
}
