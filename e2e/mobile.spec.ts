import { expect, test } from "@playwright/test";
import { signInAs, USERS } from "./helpers";

test("navigation works at phone width without horizontal scroll", async ({ page }) => {
  await signInAs(page, USERS.guy);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("link", { name: "Company Team" })
    .click();
  await expect(page).toHaveURL(/\/team$/);
});
