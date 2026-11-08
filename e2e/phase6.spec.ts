import { expect, test } from "@playwright/test";
import { clearSignInLimit, exhaustSignInLimit } from "./db";
import { signInAs, USERS } from "./helpers";

test.describe("Prompt tasks", () => {
  test("an agent works a prompt; staff review the draft and mark it done", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await page.goto("/prompts");
    await page
      .getByTestId("template-list")
      .getByRole("link", { name: /Social media post/ })
      .click();
    const editor = page.getByTestId("template-editor");
    await editor.getByLabel("Channel").fill("Instagram");
    const topic = `Weekly Q&A ${Date.now()}`;
    await editor.getByLabel("Topic").fill(topic);
    await editor.getByLabel("Hashtag count").fill("3");
    const send = editor.getByTestId("send-to-agent");
    const option = send.locator("option", { hasText: "Social Media Manager" });
    await send.getByLabel("Agent").selectOption((await option.getAttribute("value"))!);
    await send.getByRole("button", { name: "Send to agent" }).click();
    await expect(send.getByRole("status")).toContainText("finished a draft");
    await send.getByRole("link", { name: "Open workspace" }).click();

    const review = page.getByTestId("kanban").getByRole("region", { name: "In Review" });
    const card = review
      .getByRole("listitem")
      .filter({ has: page.getByTestId("task-draft") })
      .first();
    await card.getByText("View draft").click();
    await expect(card.getByTestId("task-draft")).toContainText(topic);
    await expect(card.getByTestId("task-draft")).toContainText("Approval Queue");
    await card.getByRole("button", { name: /Mark ".*" done/ }).click();
    const done = page.getByTestId("kanban").getByRole("region", { name: "Done" });
    await expect(done.getByTestId("task-draft").filter({ hasText: topic })).toHaveCount(1);
  });
});

test.describe("Sign-in protection", () => {
  test("too many sign-in requests from one address are refused, for any email", async ({
    page,
  }) => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    await page.context().clearCookies();
    await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    await exhaustSignInLimit(ip);
    try {
      await page.goto("/login");
      await page.getByLabel("Work email").fill("nobody@example.test");
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await expect(page.getByText("Too many sign-in requests")).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await clearSignInLimit(ip);
    }
  });

  test("pages are sent with protective headers", async ({ request }) => {
    const response = await request.get("/login");
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
  });
});

test.describe("Connect QuickBooks", () => {
  test("in mock mode there is nothing to connect, and only admins and executives may try", async ({
    page,
  }) => {
    await signInAs(page, USERS.isaac);
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "Connect QuickBooks" })).toHaveCount(0);
    await page.goto("/api/integrations/quickbooks/connect");
    await expect(page).toHaveURL(/\/admin\?qb=not_configured$/);
    await expect(page.getByRole("alert").filter({ hasText: "not set up" })).toBeVisible();

    await signInAs(page, USERS.maya);
    await page.goto("/api/integrations/quickbooks/connect");
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test("a callback without a matching sign-in state stores nothing", async ({ page }) => {
    await signInAs(page, USERS.guy);
    await page.goto("/api/integrations/quickbooks/callback?code=x&state=forged&realmId=1");
    // Mock mode refuses before anything else; live mode refuses the forged state.
    await expect(page).toHaveURL(/\/admin\?qb=(not_configured|expired)$/);
  });
});
