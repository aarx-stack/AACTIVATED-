import { expect, test } from "@playwright/test";
import { expectForbidden, signInAs, USERS } from "./helpers";

test.describe("Credit Builder (Finance division)", () => {
  test("an executive works the plan, records a score and adds an account", async ({ page }) => {
    await signInAs(page, USERS.guy);
    await page.goto("/finance");
    await page
      .getByTestId("credit-builder-card")
      .getByRole("link", { name: "Open Credit Builder" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Credit Builder" })).toBeVisible();

    const step = page
      .getByTestId("credit-plan")
      .locator("div.tile")
      .filter({ hasText: "Equifax business profile checked" });
    await step.getByLabel(/^Status:/).selectOption("DONE");
    await step.getByLabel(/^Notes:/).fill("Profile details confirmed.");
    await step.getByRole("button", { name: "Save" }).click();
    await expect(step.getByText(/^Done · /)).toBeVisible();

    const score = page.getByTestId("record-score");
    await score.getByLabel("Score").selectOption("FICO_SBSS");
    await score.getByLabel(/^Value/).fill("172");
    await score.getByRole("button", { name: "Record score" }).click();
    await expect(score.getByRole("status")).toContainText("Score recorded");
    await expect(page.getByTestId("credit-scores")).toContainText("172");

    const vendor = `E2E vendor ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByText("Add an account").click();
    const form = page.getByTestId("add-tradeline");
    await form.getByLabel("With").fill(vendor);
    await form.getByLabel("Dun & Bradstreet").check();
    await form.getByRole("button", { name: "Add account" }).click();
    await expect(page.getByTestId("tradelines")).toContainText(vendor);

    await page.goto("/team");
    await expect(page.getByText("Credit Builder (Finance division)")).toBeVisible();
  });

  test("staff cannot open it", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await expectForbidden(page, "/finance/credit");
  });
});
