/**
 * Screenshot harness: captures the demo in desktop + mobile, both views and
 * key states. Usage: node scripts/screenshots.mjs [outDir] [baseUrl]
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const outDir = process.argv[2] ?? "screenshots";
const base = process.argv[3] ?? "http://127.0.0.1:4173";
mkdirSync(outDir, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium/chrome-linux/chrome";

const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});

async function shoot(name, { width, height, setup, fullPage = true, motion = "reduce" }) {
  // reducedMotion also exercises the app's prefers-reduced-motion path.
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: Number(process.env.SHOT_SCALE ?? 2),
    reducedMotion: motion,
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400); // demo store's simulated fetch
  if (setup) await setup(page);
  // collapse the demo panel if it's open so shots show the product
  const demoHeader = page.getByRole("button", { name: /DEMO CONTROLS/ });
  if (await demoHeader.count()) await demoHeader.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage });
  await page.close();
  console.log(`✓ ${name}`);
}

const selectPersona = (label) => async (page) => {
  await page.selectOption('select[aria-label="Demo persona"]', { label });
  await page.waitForTimeout(500);
};

const gotoAdmin = (tabLabel) => async (page) => {
  const demoHeader = page.getByRole("button", { name: /^DEMO$/ });
  if (await demoHeader.count()) await demoHeader.click(); // open panel on mobile
  await page.getByRole("tab", { name: "Admin" }).click();
  await page.waitForTimeout(500);
  if (tabLabel) {
    await page.getByRole("button", { name: tabLabel }).first().click();
    await page.waitForTimeout(400);
  }
};

await shoot("affiliate-desktop", { width: 1440, height: 900 });
await shoot("affiliate-mobile", { width: 390, height: 844 });
await shoot("affiliate-qualified", {
  width: 1440,
  height: 900,
  setup: selectPersona("Marcus Webb — Qualified member · sample comp plan"),
});
await shoot("admin-desktop", { width: 1440, height: 900, setup: gotoAdmin(null) });
await shoot("admin-queue", { width: 1440, height: 900, setup: gotoAdmin("Review queue") });
await shoot("admin-mobile", { width: 390, height: 844, setup: gotoAdmin(null) });

await browser.close();
