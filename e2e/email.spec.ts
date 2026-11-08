import { expect, test } from "@playwright/test";
import { clearSuppressions, unsubscribeLinkFor } from "./db";
import { signInAs, USERS } from "./helpers";

test.describe("Email campaigns", () => {
  test("staff write a campaign with AI, a second person approves, then it is sent", async ({
    page,
  }) => {
    const name = `E2E clinic update ${Date.now()}`;
    await signInAs(page, USERS.maya);
    await page.goto("/content");
    await page.getByRole("link", { name: "Email campaigns" }).click();
    await page.getByRole("link", { name: "New campaign" }).click();

    await page
      .getByLabel("Draft with AI (optional)")
      .fill("Invite clinics to the December webinar.");
    await page.getByRole("button", { name: "Draft with AI" }).click();
    await expect(page.getByLabel("Subject")).not.toHaveValue("");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(/Maya/);
    await page.getByLabel("Campaign name").fill(name);
    await page.getByLabel("Send to").selectOption({ label: "Clinics" });
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByTestId("email-preview")).toContainText("Unsubscribe:");
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByTestId("campaign-status")).toHaveText("Waiting for approval");
    const campaignUrl = page.url();
    await page.getByRole("link", { name: "Approval request" }).click();
    await expect(page.getByText("You cannot approve your own request.").first()).toBeVisible();
    const approvalUrl = page.url();

    await signInAs(page, USERS.devon);
    await page.goto(approvalUrl);
    await expect(page.getByTestId("content-preview")).toContainText("To Clinics");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-status")).toHaveText("Approved");

    await signInAs(page, USERS.maya);
    await page.goto(campaignUrl);
    await expect(page.getByTestId("campaign-status")).toHaveText("Approved · ready to send");
    await page.getByRole("button", { name: /Send now/ }).click();
    await expect(page.getByTestId("campaign-status")).toHaveText("Sent");
    await expect(page.getByText("7 sent · 1 skipped")).toBeVisible();
    await expect(page.getByTestId("recipients")).toContainText("No email address");
  });

  test("the unsubscribe link works without signing in", async ({ page }) => {
    await page.context().clearCookies();
    try {
      await page.goto(unsubscribeLinkFor("mock-clinic-001", "clinic1@example.test", "e2e"));
      await page.getByRole("button", { name: "Unsubscribe" }).click();
      await expect(page.getByRole("heading", { name: "You are unsubscribed" })).toBeVisible();
    } finally {
      await clearSuppressions();
    }
  });

  test("free reps cannot use email campaigns", async ({ page }) => {
    await signInAs(page, USERS.sam);
    await page.goto("/content/email");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
