import { expect, test } from "@playwright/test";
import { assistantIdOf } from "./db";
import { signInAs, USERS } from "./helpers";

test.describe("Personal assistants", () => {
  test("staff ask their own assistant for a draft and accept it", async ({ page }) => {
    const title = `Monday briefing ${Date.now()}`;
    await signInAs(page, USERS.maya);
    await page.goto("/command-center");
    await page.getByRole("link", { name: "My assistant" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Personal Assistant");

    const form = page.getByTestId("ask-assistant");
    await form.getByLabel("Request").fill(title);
    await form
      .getByLabel("Details")
      .fill("Summarize open tasks for Operations and what needs a decision.");
    await form.getByRole("button", { name: "Send to my assistant" }).click();
    await expect(form.getByRole("status")).toContainText("The draft is under In Review");

    const review = page.getByTestId("kanban").getByRole("region", { name: "In Review" });
    const card = review.getByRole("listitem").filter({ hasText: title });
    await card.getByText("View draft").click();
    await card.getByRole("button", { name: /Mark ".*" done/ }).click();
    await expect(
      page.getByTestId("kanban").getByRole("region", { name: "Done" }).getByText(title).first(),
    ).toBeVisible();
  });

  test("assistants are private: other staff are refused, executives can only look", async ({
    page,
  }) => {
    const devons = await assistantIdOf(USERS.devon);
    const mayas = await assistantIdOf(USERS.maya);
    await signInAs(page, USERS.maya);
    await page.goto(`/agents/${devons}`);
    await expect(page).toHaveURL(/\/forbidden$/);

    await signInAs(page, USERS.guy);
    await page.goto("/agents");
    await expect(page.getByText("Yours")).toBeVisible();
    await page.goto(`/agents/${mayas}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Personal Assistant");
    await expect(page.getByTestId("ask-assistant")).toHaveCount(0);
  });

  test("the system admin has an assistant too", async ({ page }) => {
    await signInAs(page, USERS.isaac);
    await page.goto("/command-center");
    await page.getByRole("link", { name: "My assistant" }).click();
    await expect(page.getByTestId("ask-assistant")).toBeVisible();
  });
});

test("Sales, Affiliate Success and Publishing are departments", async ({ page }) => {
  await signInAs(page, USERS.guy);
  await page.goto("/team");
  for (const name of ["Sales", "Affiliate Success", "Publishing"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await page.goto("/agents");
  for (const title of ["Clinic Partnerships Manager", "Managing Editor", "Book & E-book Author"]) {
    await expect(page.getByText(title).first()).toBeVisible();
  }
});
