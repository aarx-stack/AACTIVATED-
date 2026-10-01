import { z } from "zod";
import type { AppSettingsRow } from "../types";
import { recordAudit } from "./audit";
import type { Ctx } from "./ctx";
import { UserError } from "./errors";
import { isValidTimezone } from "./time";
import { addressSchema, parse, requiredText } from "./validation";

export const DEFAULT_SETTINGS = {
  app_name: "Consumer Desk",
  accent_primary: "#3578FF",
  accent_highlight: "#35E7FF",
  accent_violet: "#8B5CF6",
  timezone: "America/Los_Angeles",
};

export async function getSettings(ctx: Ctx): Promise<AppSettingsRow> {
  const row = await ctx.store.getSettings(ctx.owner.id);
  return (
    row ?? {
      owner_id: ctx.owner.id,
      ...DEFAULT_SETTINGS,
      return_address: {},
      updated_at: "",
    }
  );
}

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a 6-digit hex colour like #3578FF.");
const settingsSchema = z.object({
  app_name: requiredText(60, "Application name"),
  accent_primary: hex,
  accent_highlight: hex,
  accent_violet: hex,
  timezone: z.string().min(1),
  return_address: addressSchema,
});

export async function saveSettings(ctx: Ctx, input: z.input<typeof settingsSchema>): Promise<AppSettingsRow> {
  const data = parse(settingsSchema, input);
  if (!isValidTimezone(data.timezone)) throw new UserError("Unknown timezone. Use an IANA name like America/Los_Angeles.");
  const saved = await ctx.store.saveSettings({ owner_id: ctx.owner.id, ...data, updated_at: "" });
  await recordAudit(ctx, {
    action: "settings.updated",
    record_type: "settings",
    summary: "Settings updated",
  });
  return saved;
}
