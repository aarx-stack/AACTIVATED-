import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { inspectPdf } from "../pdf/pdf";
import { DOCUMENT_CATEGORIES, type DocumentRow } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError, assertFound } from "./errors";
import { sha256Hex } from "./hash";
import { optionalText, parse, uuid } from "./validation";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export type AllowedMime = DocumentRow["mime_type"];

const EXTENSIONS: Record<AllowedMime, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
};

/** Detects the real file type from its first bytes. The browser-supplied type is not trusted. */
export function detectMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d)
    return "application/pdf";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  return (cleaned || "file").slice(0, 200);
}

export interface ValidatedFile {
  mime: AllowedMime;
  ext: string;
  pageCount: number | null;
  sha256: string;
}

export async function validateUpload(bytes: Uint8Array, filename: string): Promise<ValidatedFile> {
  if (bytes.length === 0) throw new UserError("The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UserError("Files must be 10 MB or smaller.");
  const mime = detectMime(bytes);
  if (!mime) throw new UserError("Only PDF, PNG and JPEG files are accepted.");
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!EXTENSIONS[mime].includes(ext)) {
    throw new UserError(`The file extension ".${ext}" does not match its contents (${mime}).`);
  }
  let pageCount: number | null = null;
  if (mime === "application/pdf") {
    pageCount = (await inspectPdf(bytes)).pageCount;
  } else {
    try {
      const probe = await PDFDocument.create();
      if (mime === "image/png") await probe.embedPng(bytes);
      else await probe.embedJpg(bytes);
    } catch {
      throw new UserError("The image could not be read. Re-save it as a standard PNG or JPEG.");
    }
    pageCount = 1;
  }
  return { mime, ext: EXTENSIONS[mime][0], pageCount, sha256: sha256Hex(bytes) };
}

const uploadSchema = z.object({
  client_id: uuid,
  case_id: z
    .string()
    .optional()
    .nullable()
    .transform((s) => (s ? s : null)),
  category: z.enum(DOCUMENT_CATEGORIES),
  description: optionalText(500),
  demo_fictional_ack: z.boolean().optional().default(false),
});

export interface UploadInput extends z.input<typeof uploadSchema> {
  filename: string;
  bytes: Uint8Array;
}

export async function uploadDocument(ctx: Ctx, input: UploadInput): Promise<DocumentRow> {
  const data = parse(uploadSchema, input);
  if (ctx.isDemo && !data.demo_fictional_ack) {
    throw new UserError(
      "Demo mode accepts only fictional test files. Confirm the file contains no real personal or identity information.",
    );
  }
  const client = assertFound(await ctx.store.get("clients", data.client_id), "Client");
  if (data.case_id) {
    const c = assertFound(await ctx.store.get("cases", data.case_id), "Case");
    if (c.client_id !== client.id) throw new UserError("That case belongs to a different client.");
  }
  const file = await validateUpload(input.bytes, input.filename);
  const storagePath = `${ctx.owner.id}/${client.id}/${randomUUID()}.${file.ext}`;
  await ctx.store.putFile(storagePath, input.bytes, file.mime);
  let row: DocumentRow;
  try {
    row = await ctx.store.insert("documents", {
      owner_id: ctx.owner.id,
      client_id: client.id,
      case_id: data.case_id,
      category: data.category,
      original_filename: safeDisplayName(input.filename),
      storage_path: storagePath,
      mime_type: file.mime,
      size_bytes: input.bytes.length,
      sha256: file.sha256,
      page_count: file.pageCount,
      description: data.description,
    });
  } catch (err) {
    await ctx.store.removeFile(storagePath).catch(() => undefined);
    throw err;
  }
  await recordAudit(ctx, {
    action: data.category === "response" ? "response.uploaded" : "document.uploaded",
    record_type: "document",
    record_id: row.id,
    client_id: client.id,
    case_id: row.case_id,
    summary: `Document uploaded (${data.category.replace(/_/g, " ")})`,
    metadata: { mime: file.mime, size_bytes: input.bytes.length, pages: file.pageCount },
  });
  return row;
}

/** Returns file bytes only after confirming the record exists for this owner (RLS in connected mode). */
export async function getDocumentFile(ctx: Ctx, documentId: string) {
  parse(uuid, documentId);
  const row = await ctx.store.get("documents", documentId);
  if (!row || row.owner_id !== ctx.owner.id) return null;
  const bytes = await ctx.store.getFile(row.storage_path);
  if (!bytes) return null;
  return { row, bytes };
}

export async function deleteDocument(ctx: Ctx, documentId: string): Promise<void> {
  parse(uuid, documentId);
  const row = assertFound(await ctx.store.get("documents", documentId), "Document");
  const attachments = await ctx.store.list("letter_attachments", { document_id: documentId });
  if (attachments.length > 0) {
    throw new UserError("This document is attached to a letter. Remove it from the letter first.");
  }
  const packets = await ctx.store.list("mailing_packets", { client_id: row.client_id });
  if (packets.some((p) => p.attachments_snapshot.some((a) => a.document_id === documentId))) {
    throw new UserError("This document is part of a generated mailing packet and is kept for the record.");
  }
  await ctx.store.remove("documents", documentId);
  await ctx.store.removeFile(row.storage_path).catch(() => undefined);
  await recordAudit(ctx, {
    action: "document.deleted",
    record_type: "document",
    record_id: documentId,
    client_id: row.client_id,
    case_id: row.case_id,
    summary: "Document deleted",
  });
}
