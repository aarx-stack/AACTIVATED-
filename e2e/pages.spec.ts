import { expect, test, type Page } from "@playwright/test";
import { signInAs, USERS } from "./helpers";
import { ALL, DETAILS, PAGES } from "./page-list";

/**
 * Every page, for every role, in both themes. Written out independently of the app's
 * permission code: if access changes, this table has to change with it.
 */
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
    await page.goto("/unsubscribe?t=forged.token");
    await expect(page.getByText("This unsubscribe link is not valid.")).toBeVisible();
    for (const p of PAGES) {
      await page.goto(p.path);
      await expect(page, `${p.path} without signing in`).toHaveURL(/\/login/);
    }
  });
});
