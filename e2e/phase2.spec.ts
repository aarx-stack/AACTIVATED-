import { expect, type Page, test } from "@playwright/test";
import { expectForbidden, signInAs, USERS } from "./helpers";

async function requestContent(page: Page, brief: string, channel = "INSTAGRAM") {
  await page.goto("/command-center");
  const form = page.getByTestId("content-request");
  await form.getByLabel("What should we post?").fill(brief);
  await form.getByLabel("Channel").selectOption(channel);
  await form.getByRole("button", { name: "Send to the Brain" }).click();
  const result = page.getByTestId("workflow-result");
  await expect(result).toBeVisible({ timeout: 20_000 });
  return result;
}

test.describe("Phase 2 milestone workflow", () => {
  test("request -> draft -> compliance -> queue -> approved and ready to schedule", async ({
    page,
  }) => {
    await signInAs(page, USERS.maya);
    const result = await requestContent(
      page,
      "An educational post about building a consistent Recovery Stack routine.",
    );
    await expect(result).toContainText("Compliance pass");
    await result.getByRole("link", { name: /Open in Approval Queue/ }).click();

    await expect(page.getByTestId("approval-status")).toHaveText("Pending");
    await expect(page.getByTestId("content-preview")).toContainText("#RecoveryStack");

    // Two people: whoever asked for the post cannot approve it.
    await expect(
      page.getByText("You asked for this, so someone else must decide it."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    const href = page.url();
    await signInAs(page, USERS.devon);
    await page.goto(href);

    // Reasoning and sources are shown above the decision buttons.
    const reasoning = await page.getByTestId("agent-reasoning").boundingBox();
    const approve = await page.getByRole("button", { name: "Approve" }).boundingBox();
    expect(reasoning!.y).toBeLessThan(approve!.y);
    await expect(page.getByTestId("sources")).toContainText("Request brief");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-status")).toHaveText("Approved");
    await expect(page.getByTestId("content-status")).toHaveText("Approved · ready to schedule");

    const trail = page.getByTestId("audit-trail");
    for (const step of [
      "Requested content from the Brain",
      "Planned the work",
      "Delegated to the Operations Manager",
      "Assigned the draft to the Content Specialist",
      "Drafted the content",
      "Ran the compliance check",
      "Submitted to the Approval Queue",
      "Approved",
      "Marked ready to schedule",
    ]) {
      await expect(trail.getByText(step, { exact: true })).toBeVisible();
    }
  });

  test("a flagged draft needs an executive until a reviewer edits it clean", async ({ page }) => {
    await signInAs(page, USERS.maya);
    const result = await requestContent(
      page,
      "Tell followers this routine cures soreness and mention BPC-157.",
      "TIKTOK",
    );
    await expect(result).toContainText("Compliance fail");
    const href = await result
      .getByRole("link", { name: /Open in Approval Queue/ })
      .getAttribute("href");

    // A second staff reviewer picks it up: it needs an executive as it stands.
    await signInAs(page, USERS.devon);
    await page.goto(href!);
    await expect(page.getByTestId("compliance-result")).toContainText("cures");
    await expect(page.getByText("This request needs an executive decision.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Title").fill("TikTok: building a recovery routine");
    await page
      .getByLabel("Caption")
      .fill(
        "Recovery is a routine, not a moment. Here is how our community builds consistent habits.",
      );
    await page.getByLabel("Hashtags").fill("#AACTIVATED #Routine");
    await page.getByRole("button", { name: "Save and re-check" }).click();

    await expect(page.getByTestId("compliance-result")).toContainText("Compliance passed");
    // The editor cannot approve their own edit, and the requester cannot either; an executive does.
    await expect(page.getByText("You edited this, so someone else must decide it.")).toBeVisible();
    await signInAs(page, USERS.guy);
    await page.goto(href!);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-status")).toHaveText("Approved");
    await expect(
      page.getByTestId("audit-trail").getByText("Edited the content (new revision)"),
    ).toBeVisible();
  });

  test("an executive can approve a failed check only with an acknowledgement", async ({ page }) => {
    await signInAs(page, USERS.maya);
    const result = await requestContent(
      page,
      "Say this miracle routine heals everything for everyone.",
      "FACEBOOK",
    );
    const href = await result
      .getByRole("link", { name: /Open in Approval Queue/ })
      .getAttribute("href");

    await signInAs(page, USERS.guy);
    await page.goto(href!);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("decision-panel").getByRole("alert")).toContainText(
      "acknowledging the findings",
    );
    await page
      .getByLabel(/Decision note/)
      .fill("Reviewed: internal training example only, will not be published publicly.");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-status")).toHaveText("Approved");
  });
});

test.describe("compliance rules", () => {
  test("staff can read the rules; only executives change them", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await page.goto("/approvals/rules");
    await expect(page.getByTestId("rules-table")).toContainText("BPC-157");
    await expect(page.getByRole("button", { name: "Add rule" })).toHaveCount(0);

    await signInAs(page, USERS.guy);
    await page.goto("/approvals/rules");
    const term = `giveaway${Date.now()}`;
    await page.getByLabel("Term or pattern").fill(term);
    await page.getByLabel("Why it is flagged").fill("Contest language needs legal review.");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByTestId("rules-table")).toContainText(term);
    await page.getByRole("button", { name: `Disable rule: ${term}` }).click();
    await expect(page.getByRole("button", { name: `Enable rule: ${term}` })).toBeVisible();
  });
});

test.describe("agent workspace", () => {
  test("staff open an agent's tabs but not confidential agents", async ({ page }) => {
    await signInAs(page, USERS.maya);
    await page.goto("/agents");
    await page.getByRole("link", { name: /Content Specialist/ }).click();
    await expect(page.getByTestId("kanban")).toBeVisible();
    await page.getByRole("tab", { name: "Role" }).click();
    await expect(page.getByText("content.draft")).toBeVisible();
    await page.getByRole("tab", { name: "Handoff" }).click();
    await expect(page.getByText("Operations Manager").first()).toBeVisible();
    await page.getByRole("tab", { name: "Report" }).click();
    await expect(page.getByText("Performance, last 14 days")).toBeVisible();

    // Confidential agents are not links, and the URL is refused on the server.
    await page.goto("/agents");
    const legalRow = page.getByRole("listitem").filter({ hasText: "Compliance Officer" });
    await expect(legalRow.getByRole("link")).toHaveCount(0);

    await signInAs(page, USERS.guy);
    await page.goto("/agents");
    await page.getByRole("link", { name: /Compliance Officer/ }).click();
    await page.waitForURL(/\/agents\/[^/]+$/);
    const legalUrl = page.url();
    await signInAs(page, USERS.maya);
    await expectForbidden(page, new URL(legalUrl).pathname);
  });

  test("executives can pause and resume an agent", async ({ page }) => {
    await signInAs(page, USERS.guy);
    await page.goto("/agents");
    await page.getByRole("link", { name: /Media Producer/ }).click();
    await page.getByRole("button", { name: "Pause agent" }).click();
    await expect(page.getByTestId("agent-status")).toContainText("Paused");
    await page.getByRole("button", { name: "Resume agent" }).click();
    await expect(page.getByTestId("agent-status")).toContainText("Active");
  });

  test("reps cannot reach agents or approvals", async ({ page }) => {
    await signInAs(page, USERS.jordan);
    await expectForbidden(page, "/agents");
    await expectForbidden(page, "/approvals");
    await expectForbidden(page, "/approvals/rules");
  });
});
