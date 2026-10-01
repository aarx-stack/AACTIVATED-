import { expect, test } from "@playwright/test";
import { demoLogin, expectNoFormError, metric, pdfBuffer } from "./helpers";

const RANDOM_ID = "3f2c1d4e-5b6a-4c7d-8e9f-0a1b2c3d4e5f";

test("unauthorized access is rejected", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get(`/api/documents/${RANDOM_ID}`)).status()).toBe(401);
  expect((await request.get(`/api/packets/${RANDOM_ID}/pdf`)).status()).toBe(401);
  expect((await request.get(`/api/letters/${RANDOM_ID}/pdf`)).status()).toBe(401);
  expect((await request.post("/api/exports/backup")).status()).toBe(403);
  expect((await request.post("/api/exports/backup", { headers: { origin: "http://127.0.0.1:3100" } })).status()).toBe(401);
});

test("full journey: login → client → case → document → letter → packet → approve → simulated mailing → history → response → follow-up → timeline", async ({ page }) => {
  await demoLogin(page);
  await expect(page.getByTestId("mode-indicator")).toContainText("DEMO DATA · MOCK MAIL");
  const baseResponses = await metric(page, "responses_received");

  // Add client
  await page.getByTestId("quick-add-client").click();
  await page.getByLabel("Full name *").fill("E2E Journey (fictional)");
  await page.getByLabel("Street address").fill("10 Test Street");
  await page.getByLabel("Apartment / suite").fill("Apt 3");
  await page.getByLabel("City").fill("Demo City");
  await page.getByLabel("State").fill("CA");
  await page.getByLabel("ZIP").fill("90000");
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}\?created=1/);
  const clientUrl = new URL(page.url());
  const clientId = clientUrl.pathname.split("/")[2];

  // Create case
  await page.getByTestId("new-case").click();
  await page.getByLabel("Case title *").fill("E2E case");
  await page.getByLabel("Organization / recipient").fill("Example Recipient (fictional)");
  await page.getByTestId("case-submit").click();
  await page.waitForURL(/tab=cases/);
  await expect(page.getByRole("heading", { name: /E2E case/ })).toBeVisible();

  // Upload supporting document
  await page.goto(`/clients/${clientId}?tab=documents`);
  await page.getByTestId("picker-case").selectOption({ label: "E2E case" });
  await page.getByTestId("upload-file").setInputFiles({ name: "e2e-evidence.pdf", mimeType: "application/pdf", buffer: await pdfBuffer("E2E evidence") });
  await page.getByTestId("demo-ack").check();
  await page.getByTestId("upload-submit").click();
  await expect(page.getByRole("link", { name: "e2e-evidence.pdf" })).toBeVisible();

  // Draft letter
  await page.goto(`/letters/new?client=${clientId}`);
  await page.getByTestId("picker-case").selectOption({ label: "E2E case" });
  await page.getByTestId("create-letter").click();
  await page.waitForURL(/\/letters\/[0-9a-f-]{36}\?created=1/);
  await page.getByTestId("letter-body").fill("To whom it may concern:\n\nThis is a fictional end-to-end test letter.\n\nSincerely,\nE2E Journey");
  await page.getByLabel("recipient name").fill("Example Recipient (fictional)");
  await page.getByLabel("recipient street").fill("20 Sample Road");
  await page.getByLabel("recipient city").fill("Demo City");
  await page.getByLabel("recipient state").fill("CA");
  await page.getByLabel("recipient ZIP").fill("90000");
  await page.getByRole("button", { name: "Attach" }).first().click();
  await expect(page.getByTestId("attachment-order")).toContainText("e2e-evidence.pdf");
  await page.getByTestId("save-draft").click();
  await expect(page.getByTestId("form-success")).toContainText("Draft saved");

  // Preview complete packet
  await page.getByTestId("prepare-packet").click();
  await page.waitForURL(/\/packets\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("packet-contents")).toContainText("Letter");
  await expect(page.getByTestId("packet-contents")).toContainText("e2e-evidence.pdf");
  await expect(page.getByText("2 pages total")).toBeVisible();
  const pdf = await page.request.get(`${new URL(page.url()).pathname.replace("/packets/", "/api/packets/")}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // Approve
  await page.getByTestId("reviewed-packet").check();
  await page.getByTestId("approve-packet").click();
  await expect(page.getByTestId("continue-to-send")).toBeVisible();
  await page.getByTestId("continue-to-send").click();

  // Simulated mailing
  await expect(page.getByText("Mock provider — simulation only")).toBeVisible();
  await page.getByTestId("confirm-final").check();
  await page.getByTestId("send-mailing").click();
  await page.waitForURL(/\/mailings\/[0-9a-f-]{36}\?outcome=accepted/);
  await expect(page.getByTestId("submit-outcome")).toContainText("not the same as mailed");
  const mailingId = new URL(page.url()).pathname.split("/")[2];
  await page.getByTestId("simulate-processing").click();
  await expect(page.getByTestId("form-success").first()).toBeVisible();
  await page.getByTestId("simulate-mailed").click();
  await expect(page.getByTestId("mailing-events")).toContainText("Simulated: Mailed");
  await page.getByTestId("refresh-status").click();
  await expect(page.getByText(/no new simulated events/)).toBeVisible();

  // View history in the Dispute Tracker
  await page.goto("/tracker?filter=mailed&q=E2E%20Journey");
  await expect(page.getByTestId("tracker-table")).toContainText("E2E Journey (fictional)");
  await expect(page.getByTestId("tracker-table")).toContainText("Mailed");
  await expect(page.getByTestId("tracker-table")).toContainText("Not available for this service");

  // Record response
  await page.goto(`/mailings/${mailingId}`);
  await page.getByTestId("add-response").click();
  await expect(page.getByTestId("picker-mailing")).not.toHaveValue("");
  await page.getByLabel("Sender (who it is from)").fill("Example Recipient (fictional)");
  await page.getByLabel("Notes").fill("Fictional reply received.");
  await page.getByTestId("response-submit").click();
  await page.waitForURL(/\/responses\/[0-9a-f-]{36}\?created=1/);
  await expect(page.getByTestId("side-by-side")).toBeVisible();
  await page.getByTestId("mark-reviewed").click();
  await expect(page.getByTestId("form-success")).toContainText("Response updated");

  // Counters update
  expect(await metric(page, "responses_received")).toBe(baseResponses + 1);

  // Follow-up
  await page.goto(`/mailings/${mailingId}`);
  await page.getByRole("button", { name: "Create follow-up" }).click();
  await expect(page.getByText("Follow-up created.")).toBeVisible();

  // Complete history on the client timeline
  await page.goto(`/clients/${clientId}?tab=timeline`);
  const timeline = page.getByTestId("timeline");
  for (const text of ["Client created", "Case created", "Document uploaded", "Letter drafted", "Packet approved", "Submitted to Mock", "Simulated provider reported", "Response received", "Response reviewed", "Follow-up set"]) {
    await expect(timeline).toContainText(text);
  }
  await expectNoFormError(page);
});

test("double-clicking Send creates exactly one mailing", async ({ page }) => {
  await demoLogin(page);
  await page.goto("/records/awaiting_approval");
  await page.getByTestId("metric-records").getByRole("link").first().click();
  await page.getByTestId("reviewed-packet").check();
  await page.getByTestId("approve-packet").click();
  await page.getByTestId("continue-to-send").click();
  const packetId = new URL(page.url()).pathname.split("/")[2];
  await page.getByTestId("confirm-final").check();
  await page.getByTestId("send-mailing").dblclick();
  await page.waitForURL(/\/mailings\/[0-9a-f-]{36}/);
  const mailingId = new URL(page.url()).pathname.split("/")[2];
  // Going back to the send page now redirects to the single existing mailing record.
  await page.goto(`/packets/${packetId}/send`);
  await expect(page).toHaveURL(/\/mailings\//);
  await page.goto(`/packets/${packetId}`);
  await expect(page.getByRole("link", { name: "Open mailing record" })).toHaveCount(1);
  await page.goto("/audit?action=mailing.submission_started");
  // Exactly one submission was started for this packet's mailing record.
  await expect(page.getByTestId("audit-table").locator("tbody tr", { hasText: `mailing:${mailingId.slice(0, 8)}` })).toHaveCount(1);
});

test("dashboard counts match the records behind them", async ({ page }) => {
  await demoLogin(page);
  const keys = ["total_clients", "active_cases", "draft_letters", "awaiting_approval", "ready_to_send", "submitted", "mailed", "delivered", "awaiting_response", "responses_received", "review_needed", "follow_ups_due", "closed_cases"];
  for (const key of keys) {
    const count = await metric(page, key);
    await page.goto(`/records/${key}`);
    const items = await page.getByTestId("metric-records").locator("li").count().catch(() => 0);
    expect(items, key).toBe(count);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`: ${count}`);
  }
});

test("@mobile navigation and forms work on iPhone", async ({ page }) => {
  await demoLogin(page);
  const noHorizontalScroll = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await noHorizontalScroll();
  await page.getByTestId("mobile-nav-toggle").click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.getByRole("link", { name: "Add client" }).click();
  await page.getByLabel("Full name *").fill("Mobile Test (fictional)");
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Mobile Test (fictional)" })).toBeVisible();
  await noHorizontalScroll();
  await page.goto("/tracker");
  await noHorizontalScroll();
});
