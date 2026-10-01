import { expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function pdfBuffer(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 14, font });
  return Buffer.from(await doc.save());
}

export async function demoLogin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("demo-login").click();
  await page.waitForURL((u) => u.pathname === "/");
}

export async function metric(page: Page, key: string): Promise<number> {
  await page.goto("/");
  return Number(await page.getByTestId(`metric-${key}-count`).innerText());
}

export async function expectNoFormError(page: Page) {
  await expect(page.getByTestId("form-error")).toHaveCount(0);
}
