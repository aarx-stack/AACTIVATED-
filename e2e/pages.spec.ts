import { expect, test, type Page } from "@playwright/test";
import { signInAs, USERS } from "./helpers";

/**
 * Every page, for every role, in both themes. Written out independently of the app's
 * permission code: if access changes, this table has to change with it.
 */
const E = "guy";
const S = "maya";
const A = "isaac";
const P = "jordan";
const F = "sam";
type Who = typeof E | typeof S | typeof A | typeof P | typeof F;
const ALL: Who[] = [E, S, A, P, F];

const PAGES: { path: string; heading: string; roles: Who[] }[] = [
  { path: "/command-center", heading: "Brain Command Center", roles: [E, S, A] },
  { path: "/team", heading: "Company Team", roles: [E, S, A] },
  { path: "/agents", heading: "Agent Workspace", roles: [E, S] },
  { path: "/approvals", heading: "Approval & Compliance Queue", roles: [E, S] },
  { path: "/approvals/rules", heading: "Content rules", roles: [E, S] },
  { path: "/content", heading: "Content Studio", roles: [E, S, P] },
  { path: "/content/new", heading: "New post", roles: [E, S, P] },
  { path: "/my-team", heading: "My AI Team", roles: [P, F] },
  { path: "/back-office", heading: "Back Office — Earnings", roles: [P, F] },
  { path: "/finance", heading: "Finance & Budget", roles: [E] },
  { path: "/finance/transactions", heading: "Transactions", roles: [E] },
  { path: "/budgets", heading: "Budgets", roles: [E, S] },
  { path: "/knowledge", heading: "Knowledge Library", roles: ALL },
  { path: "/knowledge/new", heading: "Add document", roles: [E, S] },
  { path: "/prompts", heading: "Prompt Generator", roles: [E, S] },
  { path: "/roadmap", heading: "Development & Tokenization Map", roles: [E, S, A] },
  { path: "/admin", heading: "Admin & Access Control", roles: [E, A] },
  { path: "/admin/audit", heading: "Audit Log", roles: [E] },
  { path: "/notifications", heading: "Notifications", roles: ALL },
  { path: "/settings", heading: "Settings", roles: ALL },
];

/** Detail pages, reached by following the first link on their list page. */
const DETAILS: { list: string; link: string; roles: Who[] }[] = [
  { list: "/agents", link: "a[href^='/agents/']", roles: [E, S] },
  { list: "/approvals?tab=all", link: "a[href*='selected=']", roles: [E, S] },
  { list: "/knowledge", link: "a[href^='/knowledge/']:not([href='/knowledge/new'])", roles: ALL },
];

async function expectHealthyPage(page: Page, heading: string, errors: string[]) {
  await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${heading} scrolls sideways`).toBeLessThanOrEqual(0);
  expect(errors, `${heading} threw in the browser`).toEqual([]);
}

async function setTheme(page: Page, theme: "dark" | "light") {
  const isLight = await page.evaluate(() => document.documentElement.classList.contains("light"));
  if ((theme === "light") !== isLight) {
    await page.getByTestId("theme-toggle").click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("light")))
      .toBe(theme === "light");
  }
}

for (const who of ALL) {
  test.describe(`every page as ${who}`, () => {
    test("allowed pages render cleanly in dark and light; the rest are blocked", async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await signInAs(page, USERS[who]);
      try {
        for (const theme of ["dark", "light"] as const) {
          await setTheme(page, theme);
          for (const p of PAGES.filter((x) => x.roles.includes(who))) {
            await page.goto(p.path);
            await expectHealthyPage(page, p.heading, errors);
            expect(
              await page.evaluate(() => document.documentElement.classList.contains("light")),
              `${p.path} lost the ${theme} theme`,
            ).toBe(theme === "light");
          }
          for (const d of DETAILS.filter((x) => x.roles.includes(who))) {
            await page.goto(d.list);
            const href = await page.locator(d.link).first().getAttribute("href");
            expect(href, `no link on ${d.list}`).toBeTruthy();
            await page.goto(href!);
            await expect(page.locator("h1").first()).toBeVisible();
            await expect(page.getByText("Something went wrong")).toHaveCount(0);
            expect(errors).toEqual([]);
          }
        }
      } finally {
        await setTheme(page, "dark").catch(() => undefined);
      }

      for (const p of PAGES.filter((x) => !x.roles.includes(who))) {
        await page.goto(p.path);
        await expect(page, `${who} reached ${p.path}`).toHaveURL(/\/forbidden$/);
      }
    });
  });
}

test.describe("public and signed-out pages", () => {
  test("status and sign-in work without an account; app pages need one", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/status");
    await expect(page.getByRole("heading", { level: 1, name: "System status" })).toBeVisible();
    await page.goto("/login");
    await expect(page.getByText("AACTIVATED AI BRAIN").first()).toBeVisible();
    for (const p of PAGES) {
      await page.goto(p.path);
      await expect(page, `${p.path} without signing in`).toHaveURL(/\/login/);
    }
  });
});
