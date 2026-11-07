import { expect, test } from "@playwright/test";
import { expectForbidden, signInAs, USERS } from "./helpers";

test.describe("auth", () => {
  test("redirects signed-out visitors to login", async ({ page }) => {
    await page.goto("/command-center");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  });

  test("does not reveal whether an email has an account", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("nobody@example.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/login\/check-email$/);
  });
});

test.describe("executive", () => {
  test.beforeEach(async ({ page }) => signInAs(page, USERS.guy));

  test("sees the Command Center with live data", async ({ page }) => {
    await expect(page).toHaveURL(/\/command-center$/);
    await expect(page.getByText("AACTIVATED", { exact: true }).first()).toBeVisible();
    for (const label of [
      "Active agents",
      "Tasks completed today",
      "Pending approvals",
      "AI spend vs budget",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("brain-status")).toContainText("AI CEO");
    await expect(
      page.getByRole("list", { name: "Agent activity" }).getByRole("listitem").first(),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Department health" })).toContainText(
      "Legal & Compliance",
    );
  });

  test("can ask the Brain (mock model, cost logged)", async ({ page }) => {
    await page
      .getByRole("textbox", { name: "Ask the Brain" })
      .fill("What needs my attention today?");
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(page.getByText("Mock response")).toBeVisible();
    await expect(page.getByText("logged to AI spend")).toBeVisible();
  });

  test("sees the full org chart with confidential agents", async ({ page }) => {
    await page.goto("/team");
    await expect(page.getByTestId("org-ceo")).toContainText("The Brain");
    await expect(page.getByTestId("dept-Legal & Compliance").getByRole("link")).toBeVisible();
  });

  test("theme choice is saved to the account", async ({ page, context }) => {
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
    await page.getByTestId("theme-toggle").click();
    await expect(html).not.toHaveClass(/dark/);
    // New browser storage, same account: the saved preference still applies.
    await page.waitForTimeout(500);
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await signInAs(page, USERS.guy);
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    // Restore dark for the next run.
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.waitForTimeout(500);
  });
});

test.describe("staff", () => {
  test.beforeEach(async ({ page }) => signInAs(page, USERS.maya));

  test("is blocked from admin, finance and confidential agents on the server", async ({ page }) => {
    await expectForbidden(page, "/admin");
    await expectForbidden(page, "/finance");
    await page.goto("/team");
    const legal = page.getByTestId("dept-Legal & Compliance");
    await expect(legal).toContainText("Executive only");
    await expect(legal.getByRole("link")).toHaveCount(0);
  });

  test("sees confidential activity redacted", async ({ page }) => {
    await page.goto("/command-center");
    const feed = page.getByRole("list", { name: "Agent activity" });
    await expect(feed.getByRole("listitem").first()).toBeVisible();
    for (const secret of [
      "Reconciling October transactions",
      "Software budget passed 75%",
      "TikTok policy update",
      "proposed blocklist",
      "Contractor review summary",
    ]) {
      await expect(feed.getByText(secret)).toHaveCount(0);
    }
  });
});

test.describe("system admin", () => {
  test.beforeEach(async ({ page }) => signInAs(page, USERS.isaac));

  test("manages users but cannot grant the Executive role", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin & Access Control" })).toBeVisible();
    await page.getByRole("combobox", { name: /Role for Sam Carter/ }).click();
    await expect(page.getByRole("option", { name: "Premium Rep" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Executive" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Guy is an executive: Isaac cannot change his role at all.
    await expect(page.getByRole("combobox", { name: /Role for Guy Griffithe/ })).toBeDisabled();
  });

  test("sees the permission matrix and system status", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Permission matrix" }).click();
    await expect(page.getByTestId("permission-matrix")).toContainText("confidential.legal");
    await page.getByRole("tab", { name: "System status" }).click();
    await expect(page.getByText("Database", { exact: true })).toBeVisible();
  });
});

test.describe("reps", () => {
  test("a free rep lands on My AI Team and cannot reach company areas", async ({ page }) => {
    await signInAs(page, USERS.sam);
    await expect(page).toHaveURL(/\/my-team$/);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Command Center" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Back Office" })).toBeVisible();
    await expectForbidden(page, "/command-center");
    await expectForbidden(page, "/content");
    await expectForbidden(page, "/admin");
  });

  test("a premium rep gets content studio but not approvals", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    await page.goto("/content");
    await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
    await expectForbidden(page, "/approvals");
  });
});

test.describe("always-on", () => {
  test("health endpoint and public status page", async ({ page, request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(["OPERATIONAL", "DEGRADED"]).toContain(body.status);
    await page.goto("/status");
    await expect(page.getByRole("heading", { name: "System status" })).toBeVisible();
  });
});
