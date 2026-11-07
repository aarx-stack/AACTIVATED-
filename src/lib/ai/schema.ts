import { z } from "zod";

/**
 * Structured outputs accept a subset of JSON Schema: no string-length,
 * numeric-range, pattern or array-size constraints, and every object needs
 * `additionalProperties: false`. We strip what the API rejects and keep the
 * full rules in zod, which validates the reply on our side.
 */
const UNSUPPORTED = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED.has(key)) continue;
    out[key] = clean(value);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export function toStructuredOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}
