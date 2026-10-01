import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { assemblePacket, inspectPdf, renderLetterPdf, sanitizeForFont } from "@/server/pdf/pdf";
import { TINY_PNG, samplePdf } from "../support/fixtures";

describe("letter PDF rendering", () => {
  it("keeps line breaks and maps typographic characters instead of dropping them", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const supported = new Set(font.getCharacterSet());
    expect(sanitizeForFont("Line one\nLine two\r\nThree", supported)).toBe("Line one\nLine two\nThree");
    expect(sanitizeForFont("“quoted” — it’s…", supported)).toBe('"quoted" - it\'s...');
    expect(sanitizeForFont("emoji 🙂", supported)).not.toContain("🙂");
  });

  it("renders a multi-page letter and assembles letter + PDF + image attachments in order", async () => {
    const body = Array.from({ length: 120 }, (_, i) => `Paragraph line ${i + 1}`).join("\n");
    const letter = await renderLetterPdf({
      sender: { name: "Sender", line1: "1 St", city: "Demo City", state: "CA", postal_code: "90000" },
      recipientName: "Recipient",
      recipient: { line1: "2 St", city: "Demo City", state: "CA", postal_code: "90000" },
      body,
      dateLine: "September 30, 2026",
    });
    const letterPages = (await inspectPdf(letter)).pageCount;
    expect(letterPages).toBeGreaterThan(1);
    const packet = await assemblePacket([
      { bytes: letter, mimeType: "application/pdf", label: "Letter" },
      { bytes: await samplePdf("Att", 3), mimeType: "application/pdf", label: "a.pdf" },
      { bytes: TINY_PNG, mimeType: "image/png", label: "b.png" },
    ]);
    expect(packet.partPageCounts).toEqual([letterPages, 3, 1]);
    expect(packet.pageCount).toBe(letterPages + 4);
    const check = await PDFDocument.load(packet.bytes);
    expect(check.isEncrypted).toBe(false);
  });
});
