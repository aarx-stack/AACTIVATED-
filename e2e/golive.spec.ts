import { expect, test } from "@playwright/test";
import { retireBudgetByName } from "./db";
import { signInAs, USERS } from "./helpers";

test("an executive creates a monthly budget that staff can see", async ({ page }) => {
  const name = `E2E events ${Date.now()}`;
  try {
    await signInAs(page, USERS.guy);
    await page.goto("/finance");
    await page.getByText("New budget", { exact: true }).click();
    const form = page.getByTestId("new-budget");
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Covers").selectOption("OTHER");
    await form.getByLabel("Monthly limit (USD)").fill("750");
    await form.getByRole("button", { name: "Create budget" }).click();
    await expect(form.getByRole("status")).toContainText("a month");
    await expect(page.getByTestId("budget-row").filter({ hasText: name })).toContainText("$750.00");

    await signInAs(page, USERS.maya);
    await page.goto("/budgets");
    await expect(page.getByTestId("budget-item").filter({ hasText: name })).toBeVisible();
  } finally {
    await retireBudgetByName(name);
  }
});
