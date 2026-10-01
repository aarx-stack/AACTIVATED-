import { expect, test } from "@playwright/test";
import { pdfBuffer } from "./helpers";

const EMAIL = process.env.E2E_OWNER_EMAIL!;
const PASSWORD = process.env.E2E_OWNER_PASSWORD!;
const RANDOM_ID = "3f2c1d4e-5b6a-4c7d-8e9f-0a1b2c3d4e5f";

async function login(page: import("@playwright/test").Page, email = EMAIL) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByTestId("owner-login").click();
}

test("unauthorized access is rejected and demo sign-in is unavailable", async ({ page, request }) => {
  await page.goto("/tracker");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("demo-login")).toHaveCount(0);
  expect((await request.get(`/api/documents/${RANDOM_ID}`)).status()).toBe(401);
});

test("a non-owner account cannot sign in", async ({ page }) => {
  await login(page, `intruder-${EMAIL}`);
  await expect(page.getByText("Sign-in failed. Check your email and password.")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("owner data survives refresh; private files need the owner session", async ({ page, browser }) => {
  await login(page);
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByTestId("mode-indicator")).toContainText("MOCK MAIL");
  const name = `Connected Test ${Date.now()} (fictional)`;
  await page.goto("/clients/new");
  await page.getByLabel("Full name *").fill(name);
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  const clientId = new URL(page.url()).pathname.split("/")[2];

  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.goto("/clients");
  await expect(page.getByTestId("clients-table")).toContainText(name);

  await page.goto(`/clients/${clientId}?tab=documents`);
  await expect(page.getByTestId("demo-ack")).toHaveCount(0);
  await page.getByTestId("upload-file").setInputFiles({ name: "connected.pdf", mimeType: "application/pdf", buffer: await pdfBuffer("Connected") });
  await page.getByTestId("upload-submit").click();
  const link = page.getByRole("link", { name: "connected.pdf" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  const own = await page.request.get(href);
  expect(own.status()).toBe(200);
  expect(own.headers()["cache-control"]).toContain("no-store");

  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(new URL(href, page.url()).toString())).status()).toBe(401);
  await anonymous.close();
});

test("connected journey: letter → packet → approve → simulated mailing → response", async ({ page }) => {
  await login(page);
  await page.waitForURL((u) => u.pathname === "/");
  const before = Number(await page.getByTestId("metric-responses_received-count").innerText());
  await page.goto("/clients/new");
  await page.getByLabel("Full name *").fill(`Connected Journey ${Date.now()} (fictional)`);
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  const clientId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/clients/${clientId}/cases/new`);
  await page.getByLabel("Case title *").fill("Connected case");
  await page.getByTestId("case-submit").click();
  await page.waitForURL(/tab=cases/);
  await page.goto(`/letters/new?client=${clientId}`);
  await page.getByTestId("picker-case").selectOption({ label: "Connected case" });
  await page.getByTestId("create-letter").click();
  await page.waitForURL(/\/letters\//);
  await page.getByTestId("letter-body").fill("Fictional connected-mode test letter.");
  for (const [label, value] of [
    ["recipient name", "Example Recipient (fictional)"],
    ["recipient street", "1 Sample Rd"],
    ["recipient city", "Demo City"],
    ["recipient state", "CA"],
    ["recipient ZIP", "90000"],
    ["sender name", "E2E Owner"],
    ["sender street", "2 Sample Rd"],
    ["sender city", "Demo City"],
    ["sender state", "CA"],
    ["sender ZIP", "90000"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByTestId("prepare-packet").click();
  await page.waitForURL(/\/packets\/[0-9a-f-]{36}$/);
  await page.getByTestId("reviewed-packet").check();
  await page.getByTestId("approve-packet").click();
  await page.getByTestId("continue-to-send").click();
  await page.getByTestId("confirm-final").check();
  await page.getByTestId("send-mailing").click();
  await page.waitForURL(/\/mailings\/[0-9a-f-]{36}\?outcome=accepted/);
  await page.getByTestId("add-response").click();
  await page.getByTestId("response-submit").click();
  await page.waitForURL(/\/responses\/[0-9a-f-]{36}\?created=1/);
  await page.goto("/");
  await expect(page.getByTestId("metric-responses_received-count")).toHaveText(String(before + 1));
});
