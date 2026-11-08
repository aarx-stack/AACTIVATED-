"use client";

import { ActionForm, selectClass } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  recordPurchaseAction,
  recordSpendAction,
  setLimitAction,
  syncQuickBooksAction,
} from "@/app/(app)/finance/actions";

interface BudgetOption {
  id: string;
  name: string;
}

export function RecordSpendForm({ budgets }: { budgets: BudgetOption[] }) {
  return (
    <ActionForm
      action={recordSpendAction}
      submitLabel="Record spend"
      pendingLabel="Checking budget…"
      testId="record-spend"
      resetOnSuccess
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-budget">Budget</Label>
          <select id="spend-budget" name="budgetId" className={selectClass} required>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-amount">Amount (USD)</Label>
          <Input
            id="spend-amount"
            name="amountUsd"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="spend-description">What is it for?</Label>
        <Input id="spend-description" name="description" required minLength={3} maxLength={160} />
      </div>
      <p className="text-xs text-muted-foreground">
        Spend that would take a budget past 75% is refused and goes to the Approval Queue first.
      </p>
    </ActionForm>
  );
}

export function LimitForm({ budgets }: { budgets: BudgetOption[] }) {
  return (
    <ActionForm
      action={setLimitAction}
      submitLabel="Change limit"
      buttonVariant="secondary"
      testId="change-limit"
      resetOnSuccess
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="limit-budget">Budget</Label>
          <select id="limit-budget" name="budgetId" className={selectClass} required>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="limit-amount">New limit (USD)</Label>
          <Input
            id="limit-amount"
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
        <Label htmlFor="limit-note">Reason (kept in the audit log)</Label>
        <Input id="limit-note" name="note" required minLength={5} maxLength={300} />
      </div>
    </ActionForm>
  );
}

export function RecordPurchaseButton({ approvalId, label }: { approvalId: string; label: string }) {
  return (
    <ActionForm
      action={recordPurchaseAction}
      submitLabel={label}
      buttonVariant="secondary"
      className="gap-1"
    >
      <input type="hidden" name="approvalId" value={approvalId} />
    </ActionForm>
  );
}

export function SyncNowButton() {
  return (
    <ActionForm
      action={syncQuickBooksAction}
      submitLabel="Sync now"
      pendingLabel="Syncing…"
      buttonVariant="secondary"
      className="items-end gap-1 text-right"
      testId="quickbooks-sync"
    />
  );
}
