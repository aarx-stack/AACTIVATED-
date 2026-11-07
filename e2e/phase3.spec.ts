import { expect, type Page, test } from "@playwright/test";
import { expectForbidden, signInAs, USERS } from "./helpers";

const DEVON = "devon@aactivated.test";

async function approveInQueue(page: Page, title: string | RegExp) {
  await signInAs(page, DEVON);
  await page.goto("/approvals");
  const href = await page
    .getByTestId("approval-list")
    .getByRole("link", { name: title })
    .first()
    .getAttribute("href");
  const id = new URL(href!, "http://localhost").searchParams.get("selected");
  await page.goto(`/approvals/${id}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("approval-status")).toHaveText("Approved");
}

test.describe("rep onboarding", () => {
  test("a newly invited rep accepts the rules and gets their AI team", async ({ page }) => {
    const email = `newrep${Date.now()}@aactivated.test`;
    await signInAs(page, USERS.isaac);
    await page.goto("/admin");
    await page.getByText("Add User", { exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("New Demo Rep");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Invite" }).click();
    await expect(page.getByText(`Invited ${email}`)).toBeVisible();

    await signInAs(page, email);
    await page.goto("/my-team");
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole("button", { name: /Accept and meet my Business Coach/ }).click();
    await expect(page.getByText("Please accept", { exact: false })).toHaveCount(0); // native validation blocks submit
    await page.getByLabel(/Content and posting rules/).check();
    await page.getByLabel(/Lead generation policy/).check();
    await page.getByRole("button", { name: /Accept and meet my Business Coach/ }).click();
    await expect(page).toHaveURL(/\/my-team$/);
    await expect(page.getByRole("region", { name: "Agents" })).toContainText("Business Coach");
  });
});

test.describe("premium rep: My AI Team", () => {
  test("shows the four-agent pod, Presenter badge and plans the week", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    await expect(page).toHaveURL(/\/my-team$/);
    await expect(page.getByTestId("presenter-badge")).toHaveText(/Presenter/);
    const agents = page.getByRole("region", { name: "Agents" });
    for (const name of [
      "Content Creator",
      "Social Media Manager",
      "Lead Follow-up Specialist",
      "Business Coach",
    ]) {
      await expect(agents.getByText(name, { exact: true })).toBeVisible();
    }
    await page
      .getByTestId("plan-week")
      .getByLabel(/plan the week/)
      .fill("Finish the presenter training");
    await page.getByRole("button", { name: "Plan my week" }).click();
    await expect(page.getByTestId("plan-week")).toContainText("Your week is planned");
    await expect(page.getByTestId("week-progress")).toContainText("presenter training");
  });

  test("post request -> company approval -> rep schedules through the gate", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    const form = page.getByTestId("rep-content-request");
    const topic = `my morning routine ${Date.now()}`;
    await form
      .getByLabel(/What should the post be about/)
      .fill(`An educational post about ${topic} and consistency.`);
    await form.getByRole("button", { name: "Draft my post" }).click();
    await expect(form).toContainText("sent for company approval");
    await form.getByRole("link", { name: "Open" }).click();
    await expect(page.getByTestId("post-status")).toHaveText("In review");
    const postUrl = page.url();

    await approveInQueue(page, new RegExp(topic));

    await signInAs(page, USERS.jordan);
    await page.goto(postUrl);
    await expect(page.getByTestId("post-status")).toHaveText("Approved · ready to schedule");
    await page.getByRole("button", { name: "Schedule post" }).click();
    // On success the page refreshes into its scheduled state.
    await expect(page.getByTestId("post-status")).toHaveText("Scheduled");
    await expect(page.getByText(/GoHighLevel reference/)).toBeVisible();
  });

  test("consented contact -> follow-up draft -> approval -> send", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    const name = `Lead ${Date.now()}`;
    const add = page.getByTestId("add-contact");
    await add.getByLabel("Name").fill(name);
    await add.getByLabel("Email").fill(`lead${Date.now()}@example.test`);
    await add.getByLabel("How did they opt in?").selectOption("WEB_FORM");
    await add.getByLabel("When").fill(new Date().toISOString().slice(0, 10));
    await add.getByLabel(/What did they do/).fill("Requested the recovery guide on our site");
    await add.getByRole("button", { name: "Add contact" }).click();
    await expect(add).toContainText("consent record");

    const row = page.getByTestId(`contact-${name}`);
    await row.getByRole("button", { name: "Draft follow-up" }).click();
    await expect(row.getByText("Waiting for approval")).toBeVisible();

    await approveInQueue(page, `Follow-up to ${name}`);

    await signInAs(page, USERS.jordan);
    const row2 = page.getByTestId(`contact-${name}`);
    await row2.getByRole("button", { name: /Send approved follow-up/ }).click();
    await expect(row2).toContainText("Following Up");
  });
});

test.describe("Content Studio", () => {
  test("draft -> AI suggestions -> send for review", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    await page.goto("/content");
    await expect(page.getByTestId("calendar")).toBeVisible();
    await page.getByRole("link", { name: "New post" }).click();
    const form = page.getByTestId("new-post");
    await form.getByLabel("Title").fill(`Studio draft ${Date.now()}`);
    await form
      .getByLabel("Caption")
      .fill("Recovery is a routine. Here is how our community stays consistent. Join us.");
    await form.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByTestId("post-status")).toHaveText("Draft");

    await page.getByRole("button", { name: "Suggest captions" }).click();
    const suggestions = page.getByTestId("suggestions");
    await expect(suggestions).toBeVisible();
    await suggestions.getByRole("button", { name: "Use this" }).nth(1).click();
    await expect(page.getByLabel("Caption", { exact: true })).toHaveValue(
      /What does consistency look like/,
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    await page.getByRole("button", { name: "Send for review" }).click();
    // On success the page refreshes into its in-review state (editor locked).
    await expect(page.getByTestId("post-status")).toHaveText("In review");
    await expect(page.getByTestId("post-compliance")).toContainText("Pending");
  });

  test("filters by channel and moves between months", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await page.goto("/content");
    await page
      .getByRole("navigation", { name: "Filter by channel" })
      .getByRole("link", { name: /^TikTok/ })
      .click();
    await expect(page).toHaveURL(/channel=TIKTOK/);
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  });
});

test.describe("Back Office and access", () => {
  test("a premium rep sees earnings, plan progress and payouts", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    await page.goto("/back-office");
    const earnings = page.getByRole("region", { name: "Earnings" });
    for (const label of ["This Month", "Pending", "Lifetime"]) {
      await expect(earnings.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("presenter-status")).toHaveText(/Presenter/);
    await expect(page.getByTestId("plan-progress")).toContainText("Current rank");
    await expect(page.getByTestId("payouts")).toContainText("Direct deposit");
  });

  test("a free rep gets the coach and earnings, but no studio or leads", async ({ page }) => {
    await signInAs(page, USERS.sam);
    await expect(page.getByRole("region", { name: "Agents" })).toContainText("Business Coach");
    await expect(page.getByTestId("leads")).toHaveCount(0);
    await expect(page.getByTestId("rep-content-request")).toHaveCount(0);
    await page.goto("/back-office");
    await expect(
      page.getByRole("region", { name: "Earnings" }).getByText("Lifetime", { exact: true }),
    ).toBeVisible();
    await expectForbidden(page, "/content");
  });

  test("staff cannot open a rep's back office", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await expectForbidden(page, "/back-office");
  });
});
