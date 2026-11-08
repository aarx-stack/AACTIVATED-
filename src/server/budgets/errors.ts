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

/** A limit change for this budget is already waiting for an executive. */
export class BudgetChangePendingError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly approvalId: string,
  ) {
    super(message);
  }
}
