import { expect, test } from "@playwright/test";
import { createTestBudget, retireTestBudget } from "./db";
import { expectForbidden, signInAs, USERS } from "./helpers";

test.describe("Finance & Budget", () => {
  test("executives see revenue, AI spend, budgets, QuickBooks and transactions", async ({
    page,
  }) => {
    await signInAs(page, USERS.guy);
    await page.goto("/finance");
    await expect(
      page.getByRole("heading", { name: "Finance & Budget", exact: true }),
    ).toBeVisible();
    for (const label of ["Total Revenue", "Total Expense", "Net Profit", "Budget Usage"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Revenue vs Expense" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI Spend by Department" })).toBeVisible();
    const budgets = page.getByTestId("budgets");
    await expect(
      budgets.getByTestId("budget-row").filter({ hasText: "Software subscriptions" }),
    ).toBeVisible();
    await expect(budgets.getByRole("meter").first()).toBeVisible();
    await expect(
      page.getByTestId("quickbooks").getByText("Read-only", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("transactions").getByRole("row").nth(1)).toBeVisible();

    await page.getByTestId("quickbooks-sync").getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText("Synced with QuickBooks (read-only).")).toBeVisible();

    await page.getByRole("link", { name: "View all transactions" }).click();
    await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
  });

  test("spend that would cross 75% is refused until an executive approves more", async ({
    page,
  }) => {
    const budget = await createTestBudget(1000, 700);
    try {
      await signInAs(page, USERS.guy);
      await page.goto("/finance");
      const row = page.getByTestId("budget-row").filter({ hasText: budget.name });
      await expect(row.getByText("70%")).toBeVisible();

      await page.getByText("Record spend or change a limit").click();
      const form = page.getByTestId("record-spend");
      await form.getByLabel("Budget").selectOption({ label: budget.name });
      await form.getByLabel("Amount (USD)").fill("100");
      await form.getByLabel("What is it for?").fill("Video editor, two days");
      await form.getByRole("button", { name: "Record spend" }).click();
      await expect(form.getByRole("alert")).toContainText("past the 75% approval point");

      // The refusal opened an approval request; approve it.
      await form.getByRole("link", { name: "Review the request" }).click();
      await expect(page).toHaveURL(/\/approvals\/.+/);
      await expect(page.getByText(`More spending: ${budget.name}`).first()).toBeVisible();
      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByTestId("approval-status")).toHaveText("Approved");

      // Now the same spend goes through.
      await page.goto("/finance");
      await page.getByText("Record spend or change a limit").click();
      await form.getByLabel("Budget").selectOption({ label: budget.name });
      await form.getByLabel("Amount (USD)").fill("100");
      await form.getByLabel("What is it for?").fill("Video editor, two days");
      await form.getByRole("button", { name: "Record spend" }).click();
      await expect(form.getByRole("status")).toHaveText("Recorded $100.00.");
      await expect(
        page.getByTestId("budget-row").filter({ hasText: budget.name }).getByText("80%"),
      ).toBeVisible();
    } finally {
      await retireTestBudget(budget.id);
    }
  });

  test("is executive-only, enforced on the server", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await expectForbidden(page, "/finance");
    await expectForbidden(page, "/finance/transactions");
    await signInAs(page, USERS.jordan);
    await expectForbidden(page, "/finance");
  });
});

test.describe("Knowledge Library", () => {
  test("search, categories, access tags and the AI summary panel", async ({ page }) => {
    await signInAs(page, USERS.guy);
    await page.goto("/knowledge");
    const docs = page.getByTestId("documents");
    await expect(docs.getByText("Regulatory landscape memo")).toBeVisible();
    await expect(docs.getByText("Executive Only").first()).toBeVisible();

    await page.getByLabel("Search knowledge").fill("consent");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Results for/ })).toBeVisible();
    await docs.getByRole("link", { name: /Lead generation policy/ }).click();
    const panel = page.getByTestId("ai-summary");
    await expect(panel.getByText("Lead generation policy")).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Key Takeaways" })).toBeVisible();

    await page.goto("/knowledge?category=BRAND");
    await docs.getByRole("link", { name: /Visual identity basics/ }).click();
    // Wait until the panel shows this document before asking for its summary.
    await expect(panel.getByText("Visual identity basics").first()).toBeVisible();
    await panel.getByTestId("summarize").getByRole("button").click();
    await expect(panel.getByText("Summary updated.")).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();

    await panel.getByRole("link", { name: "View full document" }).click();
    await expect(page.getByRole("heading", { name: "Visual identity basics" })).toBeVisible();
  });

  test("staff never receive executive-only documents, even by URL", async ({ page }) => {
    await signInAs(page, USERS.guy);
    await page.goto("/knowledge?category=LEGAL_RESEARCH");
    const href = await page
      .getByTestId("documents")
      .getByRole("link", { name: /Regulatory landscape memo/ })
      .getAttribute("href");
    const id = new URL(href!, "http://x").searchParams.get("doc")!;

    await signInAs(page, USERS.maya);
    await page.goto("/knowledge");
    await expect(page.getByTestId("documents").getByText("Agent usage policy")).toBeVisible();
    await expect(page.getByText("Regulatory landscape memo")).toHaveCount(0);
    await page.goto(`/knowledge/${id}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.goto(`/knowledge?doc=${id}`);
    await expect(page.getByText("Regulatory landscape memo")).toHaveCount(0);
  });

  test("reps see documents for everyone and cannot add or refresh", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    await page.goto("/knowledge");
    await expect(page.getByTestId("documents").getByText("Content & posting rules")).toBeVisible();
    await expect(page.getByText("Agent usage policy")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add document" })).toHaveCount(0);
    await expect(page.getByTestId("summarize")).toHaveCount(0);
    await expectForbidden(page, "/knowledge/new");
  });

  test("staff add a document and the Brain summarizes it", async ({ page }) => {
    const title = `Weekly huddle notes ${Date.now()}`;
    await signInAs(page, USERS.maya);
    await page.goto("/knowledge/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Category").selectOption("TRAINING");
    await page.getByLabel("Who can read it").selectOption("ALL_STAFF");
    await page
      .getByLabel("Document text")
      .fill(
        "Notes from the weekly huddle. The content sprint is on track.\n- Two posts approved.\n- One caption needs a rewrite.",
      );
    await page.getByRole("button", { name: "Add document" }).click();
    await expect(page.getByText("Document added with an AI summary.")).toBeVisible();
    await page.getByRole("link", { name: "Open document" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });
});

test.describe("Prompt Generator", () => {
  test("chat with the Brain, use its template and save it", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await page.goto("/prompts?template=new");
    const chat = page.getByTestId("brain-chat");
    await chat.getByLabel("Message the Brain").fill("Create a prompt for a weekly Q&A post");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.getByText(/Here is a reusable template/)).toBeVisible();
    await chat.getByRole("button", { name: "Use template" }).click();

    const editor = page.getByTestId("template-editor");
    await expect(editor.getByLabel("Prompt template")).toHaveValue(/\{\{audience\}\}/);
    await editor.getByLabel("Name").fill(`Weekly Q&A ${Date.now()}`);
    await editor
      .getByTestId("save-template")
      .getByRole("button", { name: "Save template" })
      .click();
    await expect(editor.getByText("Template created.")).toBeVisible();
  });

  test("fill variables, send to an agent, and keep a version history", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await page.goto("/prompts");
    await page
      .getByTestId("template-list")
      .getByRole("link", { name: /Social media post/ })
      .click();
    const editor = page.getByTestId("template-editor");
    await expect(editor.getByLabel("Name")).toHaveValue("Social media post");

    // Missing variables are refused.
    const send = editor.getByTestId("send-to-agent");
    const option = send.locator("option", { hasText: "Social Media Manager" });
    await send.getByLabel("Agent").selectOption((await option.getAttribute("value"))!);
    await send.getByRole("button", { name: "Send to agent" }).click();
    await expect(send.getByRole("alert")).toContainText("Fill in");

    await editor.getByLabel("Channel").fill("Instagram");
    await editor.getByLabel("Topic").fill("Our weekly Q&A");
    await editor.getByLabel("Hashtag count").fill("3");
    await expect(editor.getByTestId("prompt-preview")).toContainText("Our weekly Q&A");
    await send.getByRole("button", { name: "Send to agent" }).click();
    await expect(send.getByRole("status")).toContainText("Social Media Manager");

    // A save adds a version; history keeps the old one.
    const body = editor.getByLabel("Prompt template");
    await body.fill(`${await body.inputValue()} Keep it under 80 words.`);
    await editor
      .getByTestId("save-template")
      .getByLabel("What changed? (optional)")
      .fill("Shorter");
    const before = await page.getByTestId("version-history").getByRole("listitem").count();
    await editor
      .getByTestId("save-template")
      .getByRole("button", { name: "Save new version" })
      .click();
    // The editor reloads on the new version; history keeps every earlier one.
    const history = page.getByTestId("version-history");
    await expect(history.getByRole("listitem")).toHaveCount(before + 1);
    await expect(history.getByRole("listitem").first()).toContainText("Shorter");
    await expect(history.getByRole("listitem").first()).toContainText("Current");
    await expect(history.getByText("Current", { exact: true })).toHaveCount(1);
  });

  test("is for company staff only", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    await expectForbidden(page, "/prompts");
    await signInAs(page, USERS.sam);
    await expectForbidden(page, "/prompts");
  });
});
