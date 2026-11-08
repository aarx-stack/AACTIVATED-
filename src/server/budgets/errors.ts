/** Spending was refused because the budget needs an executive's approval first (the 75% rule). */
export class BudgetApprovalRequiredError extends Error {
  readonly status = 423;
  constructor(
    message: string,
    readonly budgetId: string,
    readonly approvalId: string | null = null,
  ) {
    super(message);
  }
}
