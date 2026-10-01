import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Address } from "../types";
import { UserError } from "../services/errors";

// US Letter, in PDF points (1 in = 72 pt).
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const MARGIN_X = 72;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 72;
/**
 * Recipient block placement. This is a conventional #10 window position (about 2 in from the
 * top, 1 in from the left). It is NOT verified against LetterStream's address-layout rules,
 * which are only published in the account's API documentation.
 */
export const RECIPIENT_BLOCK_TOP = 144;

export interface LetterContent {
  sender: Address;
  recipientName: string;
  recipient: Address;
  body: string;
  dateLine: string;
}

export interface PdfInspection {
  pageCount: number;
  nonLetterSizedPages: number;
}

/** Throws a UserError for malformed, encrypted, password-protected or empty PDFs. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  if (bytes.length < 8 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new UserError("The file is not a PDF.");
  }
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const name = (err as Error)?.name ?? "";
    if (/Encrypt/i.test(name) || /encrypt/i.test((err as Error)?.message ?? "")) {
      throw new UserError("Encrypted or password-protected PDFs are not accepted.");
    }
    throw new UserError("The PDF could not be read (it may be damaged or malformed).");
  }
  if (doc.isEncrypted) throw new UserError("Encrypted or password-protected PDFs are not accepted.");
  let pages;
  try {
    pages = doc.getPages();
    for (const p of pages) p.getSize();
  } catch {
    throw new UserError("The PDF could not be read (it may be damaged or malformed).");
  }
  if (pages.length === 0) throw new UserError("The PDF has no pages.");
  const nonLetterSizedPages = pages.filter((p) => {
    const { width, height } = p.getSize();
    return Math.abs(width - PAGE_WIDTH) > 2 || Math.abs(height - PAGE_HEIGHT) > 2;
  }).length;
  return { pageCount: pages.length, nonLetterSizedPages };
}

const REPLACEMENTS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
  "\t": "    ",
};

/**
 * Standard PDF fonts only cover WinAnsi; replace unsupported characters rather than failing.
 * Line breaks are preserved (they are layout, not glyphs).
 */
export function sanitizeForFont(text: string, supported: Set<number>): string {
  return [...text.replace(/\r\n?/g, "\n")]
    .map((ch) => REPLACEMENTS[ch] ?? ch)
    .join("")
    .split("")
    .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0)!) ? ch : "?"))
    .join("");
}

function sanitizer(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (text: string) => sanitizeForFont(text, supported);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of rawLine.split(/ +/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      // Hard-break words longer than the line.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

export function addressLines(name: string | undefined, a: Address): string[] {
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [name ?? a.name, a.line1, a.line2, cityLine, a.country && a.country !== "US" ? a.country : undefined]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
}

/** Renders the letter itself: plain black text on white, no branding or backgrounds. */
export async function renderLetterPdf(content: LetterContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Letter");
  doc.setCreator("Consumer Desk");
  doc.setProducer("Consumer Desk");
  const body = await doc.embedFont(StandardFonts.TimesRoman);
  const clean = sanitizer(body);
  const black = rgb(0, 0, 0);
  const textWidth = PAGE_WIDTH - MARGIN_X * 2;

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN_TOP;

  const senderLines = addressLines(content.sender.name, content.sender);
  for (const line of senderLines) {
    page.drawText(clean(line), { x: MARGIN_X, y: y - 10, size: 10.5, font: body, color: black });
    y -= 13;
  }

  // Recipient block at the conventional window position.
  y = PAGE_HEIGHT - RECIPIENT_BLOCK_TOP;
  for (const line of addressLines(content.recipientName, content.recipient)) {
    page.drawText(clean(line), { x: MARGIN_X, y: y - 11, size: 11.5, font: body, color: black });
    y -= 14.5;
  }

  y -= 30;
  page.drawText(clean(content.dateLine), { x: MARGIN_X, y: y - 11, size: 11.5, font: body, color: black });
  y -= 34;

  const size = 11.5;
  const lineHeight = 15;
  for (const line of wrap(clean(content.body), body, size, textWidth)) {
    if (y - lineHeight < MARGIN_BOTTOM) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN_TOP - 18;
    }
    if (line) page.drawText(line, { x: MARGIN_X, y: y - size, size, font: body, color: black });
    y -= lineHeight;
  }

  const pages = doc.getPages();
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = `Page ${i + 1} of ${pages.length}`;
      const w = body.widthOfTextAtSize(label, 9);
      p.drawText(label, { x: (PAGE_WIDTH - w) / 2, y: 36, size: 9, font: body, color: black });
    });
  }
  return doc.save();
}

export interface PacketPart {
  bytes: Uint8Array;
  mimeType: string;
  label: string;
}

export interface AssembledPacket {
  bytes: Uint8Array;
  pageCount: number;
  partPageCounts: number[];
}

/** Letter first, then each attachment in the given order. Images become full letter pages. */
export async function assemblePacket(parts: PacketPart[]): Promise<AssembledPacket> {
  const out = await PDFDocument.create();
  out.setTitle("Mailing packet");
  out.setCreator("Consumer Desk");
  out.setProducer("Consumer Desk");
  const partPageCounts: number[] = [];

  for (const part of parts) {
    if (part.mimeType === "application/pdf") {
      await inspectPdf(part.bytes);
      const src = await PDFDocument.load(part.bytes, { updateMetadata: false });
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
      partPageCounts.push(copied.length);
    } else if (part.mimeType === "image/png" || part.mimeType === "image/jpeg") {
      let image;
      try {
        image = part.mimeType === "image/png" ? await out.embedPng(part.bytes) : await out.embedJpg(part.bytes);
      } catch {
        throw new UserError(`Attachment "${part.label}" is not a readable ${part.mimeType === "image/png" ? "PNG" : "JPEG"} image.`);
      }
      const page = out.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const maxW = PAGE_WIDTH - 72;
      const maxH = PAGE_HEIGHT - 72;
      const scale = Math.min(maxW / image.width, maxH / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: (PAGE_WIDTH - w) / 2, y: (PAGE_HEIGHT - h) / 2, width: w, height: h });
      partPageCounts.push(1);
    } else {
      throw new UserError(`Unsupported attachment type for "${part.label}".`);
    }
  }

  const bytes = await out.save();
  const check = await inspectPdf(bytes);
  return { bytes, pageCount: check.pageCount, partPageCounts };
}

/** A small, obviously fictional PDF used by the demo seed. */
export async function renderFictionalSamplePdf(title: string, lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawText("FICTIONAL SAMPLE DOCUMENT - DEMO DATA ONLY", { x: 72, y: 720, size: 12, font });
  page.drawText(title, { x: 72, y: 690, size: 14, font });
  lines.forEach((l, i) => page.drawText(l, { x: 72, y: 660 - i * 18, size: 11, font }));
  return doc.save();
}
