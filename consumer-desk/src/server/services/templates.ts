import { z } from "zod";
import type { CaseRow, ClientRow, TemplateRow } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError, assertFound } from "./errors";
import { optionalText, parse, requiredText, uuid } from "./validation";

/**
 * Neutral starter templates. They contain only structure and [[PLACEHOLDERS]] for facts the
 * owner supplies. They cite no statutes, assert no legal theories, promise no results and
 * include no signature images. {{tokens}} are filled from the selected client/case records.
 */
export const STARTER_TEMPLATES: Omit<TemplateRow, "owner_id" | "created_at" | "updated_at">[] = [
  {
    id: "starter-blank",
    name: "Blank letter",
    letter_type: "general",
    body: "",
    is_starter: true,
  },
  {
    id: "starter-general",
    name: "General correspondence (neutral)",
    letter_type: "correspondence",
    body: [
      "Re: {{case.title}}{{case.account_ref}}",
      "",
      "To whom it may concern:",
      "",
      "I am writing regarding [[DESCRIBE THE MATTER IN YOUR OWN WORDS]].",
      "",
      "[[STATE THE FACTS YOU WANT TO COMMUNICATE]]",
      "",
      "[[STATE WHAT YOU ARE ASKING THE RECIPIENT TO DO]]",
      "",
      "Please send any written reply to the address above.",
      "",
      "Enclosures: [[LIST ENCLOSURES, OR DELETE THIS LINE]]",
      "",
      "Sincerely,",
      "",
      "",
      "{{client.full_name}}",
    ].join("\n"),
    is_starter: true,
  },
  {
    id: "starter-information-request",
    name: "Request for information (neutral)",
    letter_type: "information_request",
    body: [
      "Re: {{case.title}}{{case.account_ref}}",
      "",
      "To whom it may concern:",
      "",
      "I am requesting the following information about [[DESCRIBE THE ACCOUNT OR MATTER]]:",
      "",
      "1. [[FIRST ITEM REQUESTED]]",
      "2. [[SECOND ITEM REQUESTED, OR DELETE]]",
      "",
      "Please send the information to the address above.",
      "",
      "Sincerely,",
      "",
      "",
      "{{client.full_name}}",
    ].join("\n"),
    is_starter: true,
  },
  {
    id: "starter-follow-up",
    name: "Follow-up on earlier letter (neutral)",
    letter_type: "follow_up",
    body: [
      "Re: {{case.title}}{{case.account_ref}}",
      "",
      "To whom it may concern:",
      "",
      "I am following up on my letter dated [[DATE OF EARLIER LETTER]] regarding [[DESCRIBE THE MATTER]].",
      "",
      "[[DESCRIBE WHAT HAS OR HAS NOT HAPPENED SINCE, IN YOUR OWN WORDS]]",
      "",
      "Sincerely,",
      "",
      "",
      "{{client.full_name}}",
    ].join("\n"),
    is_starter: true,
  },
];

export function formatLongDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "long", day: "numeric" }).format(
    date,
  );
}

export function clientAddressText(c: ClientRow): string {
  const cityLine = [c.city, [c.state, c.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [c.address_line1, c.address_line2, cityLine].filter(Boolean).join("\n");
}

/** Replace {{tokens}} with values from the selected records. Unknown tokens are left visible. */
export function applyTokens(body: string, client: ClientRow, kase: CaseRow | null, timezone: string): string {
  const values: Record<string, string> = {
    "client.full_name": client.full_name,
    "client.address": clientAddressText(client),
    "client.email": client.email ?? "",
    "client.phone": client.phone ?? "",
    "case.title": kase?.title ?? "",
    "case.organization": kase?.organization ?? "",
    "case.account_ref": kase?.account_last4 ? ` (account ending in ${kase.account_last4})` : "",
    today: formatLongDate(new Date(), timezone),
  };
  return body.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (m, key: string) => (key in values ? values[key] : m));
}

export function findPlaceholders(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\]]{1,200})\]\]/g)].map((m) => m[1]))];
}

export async function listTemplates(ctx: Ctx): Promise<TemplateRow[]> {
  const own = (await ctx.store.list("templates")).sort((a, b) => a.name.localeCompare(b.name));
  const starters = STARTER_TEMPLATES.map((t) => ({ ...t, owner_id: ctx.owner.id, created_at: "", updated_at: "" }));
  return [...starters, ...own];
}

export async function getTemplate(ctx: Ctx, id: string): Promise<TemplateRow | null> {
  const starter = STARTER_TEMPLATES.find((t) => t.id === id);
  if (starter) return { ...starter, owner_id: ctx.owner.id, created_at: "", updated_at: "" };
  if (!uuid.safeParse(id).success) return null;
  return ctx.store.get("templates", id);
}

const templateSchema = z.object({
  name: requiredText(120, "Template name"),
  letter_type: optionalText(60).transform((s) => s || "general"),
  body: optionalText(50000),
});

export async function saveTemplate(ctx: Ctx, id: string | null, input: z.input<typeof templateSchema>) {
  const data = parse(templateSchema, input);
  if (id) {
    if (STARTER_TEMPLATES.some((t) => t.id === id)) throw new UserError("Starter templates cannot be edited. Save a copy.");
    parse(uuid, id);
    assertFound(await ctx.store.get("templates", id), "Template");
    return assertFound(await ctx.store.update("templates", id, data), "Template");
  }
  const row = await ctx.store.insert("templates", { ...data, owner_id: ctx.owner.id, is_starter: false });
  await recordAudit(ctx, {
    action: "template.created",
    record_type: "template",
    record_id: row.id,
    summary: `Template saved: ${row.name}`,
  });
  return row;
}

export async function deleteTemplate(ctx: Ctx, id: string) {
  parse(uuid, id);
  assertFound(await ctx.store.get("templates", id), "Template");
  await ctx.store.remove("templates", id);
}
