import { z } from "zod";
import { UserError } from "./errors";

export const uuid = z.string().uuid("Invalid identifier.");
export const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Must be ${max} characters or fewer.`)
    .transform((s) => s.trim())
    .optional()
    .default("");
export const requiredText = (max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .transform((s) => s.trim())
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`));
export const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null));
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
export const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((s) => (s && s.trim() ? s.trim() : null))
  .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), "Use a valid date.");

export const addressSchema = z.object({
  name: optionalText(200),
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(100),
  state: optionalText(50),
  postal_code: optionalText(20),
  country: optionalText(60).transform((s) => s || "US"),
});

/**
 * Rejects values that look like full SSNs or full financial account numbers. This first version
 * never stores them; only the last four digits of an account reference are allowed.
 */
export function assertNoSensitiveNumbers(fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(value) || /\b(?!\d{5}\b)\d{9}\b/.test(value.replace(/[\s-]/g, " "))) {
      throw new UserError(
        `The ${key.replace(/_/g, " ")} field looks like it contains a Social Security number. Do not store full SSNs.`,
      );
    }
    if (/\b(?:\d[ -]?){12,19}\b/.test(value)) {
      throw new UserError(
        `The ${key.replace(/_/g, " ")} field looks like it contains a full account or card number. Store only the last four digits.`,
      );
    }
  }
}

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    throw new UserError(`${where}${first?.message ?? "Invalid input."}`);
  }
  return result.data;
}
