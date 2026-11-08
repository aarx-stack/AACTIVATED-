import { expect, test } from "@playwright/test";
import { createGatedProject, removeProject, removeProjectByName } from "./db";
import { signInAs, USERS } from "./helpers";

test.describe("Development & Tokenization Map", () => {
  test("the tokenization platform is mapped but cannot move without an executive", async ({
    page,
  }) => {
    await signInAs(page, USERS.maya);
    await page.goto("/roadmap");
    const row = page.getByTestId("roadmap-row").filter({ hasText: "Tokenization platform" });
    await expect(row.getByText("Tokenization", { exact: true })).toBeVisible();
    await expect(row.getByTestId("locked-stage")).toHaveCount(2);
    await expect(row.getByRole("button", { name: /Move to/ })).toHaveCount(0);
    await expect(page.getByTestId("tokenization-guardrails")).toContainText(
      "Launch is not possible without executive approval",
    );
  });

  test("staff move ideas onto the map and forward; gated launches wait for an executive", async ({
    page,
  }) => {
    // Ideas backlog -> map -> Build, all by staff.
    const idea = `E2E idea ${Date.now()}`;
    test.info().attach("idea", { body: idea });
    await signInAs(page, USERS.maya);
    await page.goto("/roadmap");
    const backlog = page.getByTestId("ideas-backlog");
    await backlog.getByText("Add an idea").click();
    await backlog.getByLabel("Idea").fill(idea);
    await backlog.getByLabel("In one sentence").fill("Created by the browser test.");
    await backlog.getByRole("button", { name: "Add idea" }).click();
    const item = backlog.getByRole("listitem").filter({ hasText: idea });
    await item.getByRole("button", { name: "Add to Map" }).click();
    const row = page.getByTestId("roadmap-row").filter({ hasText: idea });
    await row.getByRole("button", { name: "Move to Build" }).click();
    await expect(row.getByTestId("current-stage")).toContainText("(Build)");

    // A launch that needs approval: staff request it, an executive decides it with a note.
    const gated = await createGatedProject();
    try {
      await page.goto("/roadmap");
      const gatedRow = page.getByTestId("roadmap-row").filter({ hasText: gated.name });
      await gatedRow.getByText("Request approval to move to Launch").click();
      await gatedRow.getByRole("button", { name: "Send for approval" }).click();
      await expect(gatedRow.getByText("Waiting for an executive decision")).toBeVisible();
      await expect(gatedRow.getByText("Pending Approval")).toBeVisible();

      await signInAs(page, USERS.guy);
      await page.goto("/roadmap");
      await page
        .getByTestId("roadmap-row")
        .filter({ hasText: gated.name })
        .getByRole("link", { name: "Decide in the Approval Queue" })
        .click();
      await expect(page.getByText(`Launch: ${gated.name} to Launch`).first()).toBeVisible();
      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Add a short note" })).toBeVisible();
      await page.getByLabel(/Decision note/).fill("Launch checklist signed off by QA.");
      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByTestId("approval-status")).toHaveText("Approved");

      await page.goto("/roadmap");
      await expect(
        page.getByTestId("roadmap-row").filter({ hasText: gated.name }).getByText("Live"),
      ).toBeVisible();
    } finally {
      await removeProject(gated.id);
      await removeProjectByName(idea);
    }
  });
});

test.describe("Integrations", () => {
  test("a system admin can turn an integration off and on; everyone else cannot", async ({
    page,
  }) => {
    await signInAs(page, USERS.isaac);
    await page.goto("/admin");
    const slack = page.getByRole("listitem").filter({ hasText: "Internal team notifications." });
    await slack.getByRole("button", { name: "Turn off Slack" }).click();
    await expect(slack.getByText("Off", { exact: true })).toBeVisible();
    await slack.getByRole("button", { name: "Turn on Slack" }).click();
    await expect(slack.getByText("Off", { exact: true })).toHaveCount(0);

    await signInAs(page, USERS.guy);
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: /Turn (off|on) Slack/ })).toHaveCount(0);
  });
});
