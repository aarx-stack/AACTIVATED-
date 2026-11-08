import { expect, test } from "@playwright/test";
import { signInAs, USERS } from "./helpers";

test.describe("Publishing", () => {
  test("outline an e-book with AI, write it, get it approved, export it", async ({ page }) => {
    const title = `E2E guide ${Date.now()}`;
    await signInAs(page, USERS.maya);
    await page.goto("/content");
    await page.getByRole("link", { name: "Publishing" }).click();
    await page.getByRole("link", { name: "New publication" }).click();
    const form = page.getByTestId("new-publication");
    await form.getByLabel("Title", { exact: true }).fill(title);
    await form.getByLabel("Type").selectOption("EBOOK");
    await form.getByLabel("Who it is for").fill("new members");
    await form
      .getByLabel("What it is about")
      .fill("A short guide to a steady weekly recovery routine.");
    await form.getByLabel("Number of chapters or sections").fill("3");
    await form.getByRole("button", { name: "Create and outline with AI" }).click();

    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const parts = page.getByTestId("section-list").getByRole("listitem");
    await expect(parts).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      await parts.nth(i).getByRole("link").click();
      await expect(page.getByRole("heading", { name: `Chapter ${i + 1}` })).toBeVisible();
      await page.getByRole("button", { name: "Write with AI" }).click();
      await expect(page.getByLabel("Text")).not.toHaveValue("");
    }
    await page.reload();
    await expect(parts.filter({ hasText: "Not written yet" })).toHaveCount(0);

    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByTestId("publication-status")).toHaveText("Waiting for approval");
    const href = await page.getByRole("link", { name: "Approval request" }).getAttribute("href");

    // Before approval, exports are marked DRAFT.
    const draft = await page.request.get(
      page
        .url()
        .replace(/\/content\/publishing\//, "/api/publishing/")
        .split("?")[0] + "/epub",
    );
    expect(draft.headers()["content-disposition"]).toContain(".draft.epub");

    await signInAs(page, USERS.guy);
    await page.goto(href!);
    await expect(page.getByTestId("publication-preview")).toContainText(title);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-status")).toHaveText("Approved");
    await page.getByRole("link", { name: "Read the full text" }).click();
    await expect(page.getByTestId("publication-status")).toHaveText("Approved to publish");

    const id = page.url().split("/content/publishing/")[1]!.split("?")[0];
    const epub = await page.request.get(`/api/publishing/${id}/epub`);
    expect(epub.status()).toBe(200);
    expect(epub.headers()["content-type"]).toBe("application/epub+zip");
    expect(epub.headers()["content-disposition"]).not.toContain("draft");
    expect((await epub.body()).subarray(30, 38).toString()).toBe("mimetype");

    await page.goto(`/print/publishing/${id}`);
    await expect(page.getByTestId("print-book")).toContainText(title);
    await expect(page.getByTestId("print-book")).not.toContainText("DRAFT");
  });

  test("reps and the system admin cannot use Publishing", async ({ page }) => {
    for (const who of [USERS.jordan, USERS.isaac]) {
      await signInAs(page, who);
      await page.goto("/content/publishing");
      await expect(page).toHaveURL(/\/forbidden$/);
    }
    const res = await page.request.get("/api/publishing/anything/epub");
    expect(res.status()).toBe(403);
  });
});
