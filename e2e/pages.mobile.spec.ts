import { expect, test } from "@playwright/test";
import { signInAs, USERS } from "./helpers";
import { E, P, PAGES, S } from "./page-list";

/** Every page a person can open, on a phone: it renders and never scrolls sideways. */
for (const who of [E, S, P] as const) {
  test(`every page fits a phone screen for ${who}`, async ({ page }) => {
    test.setTimeout(180_000);
    await signInAs(page, USERS[who]);
    for (const p of PAGES.filter((x) => x.roles.includes(who))) {
      await page.goto(p.path);
      await expect(
        page.getByRole("heading", { level: 1, name: p.heading, exact: true }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${p.path} scrolls sideways on a phone`).toBeLessThanOrEqual(0);
    }
  });
}

test("the app can be installed on a phone", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ short_name: "AI Brain", display: "standalone", start_url: "/" });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).headers()["content-type"]).toBe("image/png");
  }
  await signInAs(page, USERS.maya);
  await page.goto("/settings");
  await expect(page.getByTestId("install-app")).toContainText("Add to Home Screen");
});
