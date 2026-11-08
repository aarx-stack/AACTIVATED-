import { expect, test } from "@playwright/test";
import { createTestBudget, retireTestBudget } from "./db";
import { signInAs, USERS } from "./helpers";

test.describe("Budget limit changes", () => {
  test("staff request a new limit; it applies only when an executive approves", async ({
    page,
  }) => {
    const budget = await createTestBudget(1000, 300);
    try {
      await signInAs(page, USERS.maya);
      await page.goto("/command-center");
      await page.getByRole("link", { name: "Budgets", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Budgets" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Transactions" })).toHaveCount(0);

      const form = page.getByTestId("request-limit-change");
      await form.getByLabel("Budget").selectOption({ label: budget.name });
      await form.getByLabel("New limit (USD)").fill("1400");
      await form.getByLabel("Why").fill("Two contractors join for the November sprint.");
      await form.getByRole("button", { name: "Request change" }).click();
      await expect(form.getByRole("status")).toContainText("Sent to the Approval Queue");

      const item = page.getByTestId("budget-item").filter({ hasText: budget.name });
      await expect(item.getByText("$1,000.00")).toBeVisible();
      await expect(item.getByTestId("pending-change")).toContainText("$1,400.00");

      // An executive decides it in the queue.
      await signInAs(page, USERS.guy);
      await page.goto("/budgets");
      await page
        .getByTestId("budget-item")
        .filter({ hasText: budget.name })
        .getByTestId("pending-change")
        .click();
      await expect(page.getByTestId("budget-change")).toContainText("$1,400.00");
      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByTestId("approval-status")).toHaveText("Approved");
      await expect(page.getByText("The new limit is in effect.")).toBeVisible();

      await page.goto("/finance");
      const row = page.getByTestId("budget-row").filter({ hasText: budget.name });
      await expect(row.getByText("/ $1,400.00")).toBeVisible();
      await expect(row.getByTestId("pending-limit-change")).toHaveCount(0);
    } finally {
      await retireTestBudget(budget.id);
    }
  });
});
