import { expect, type Page } from "@playwright/test";

export const USERS = {
  guy: "guy@aactivated.test",
  isaac: "isaac@aactivated.test",
  maya: "maya@aactivated.test",
  devon: "devon@aactivated.test",
  jordan: "jordan@aactivated.test",
  sam: "sam@aactivated.test",
} as const;

export async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId(`demo-login-${email}`).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function expectForbidden(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(
    page.getByRole("heading", { name: "You do not have access to this area" }),
  ).toBeVisible();
}
