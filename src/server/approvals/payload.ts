import { createHash } from "node:crypto";

/** Deterministic JSON (sorted keys) so equal payloads always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** What a social post approval carries. Exactly this leaves the building once approved. */
export interface SocialPostPayload {
  channel: string;
  title: string;
  caption: string;
  hashtags: string[];
}

export function isSocialPostPayload(value: unknown): value is SocialPostPayload {
  const v = value as SocialPostPayload;
  return (
    !!v &&
    typeof v.caption === "string" &&
    typeof v.channel === "string" &&
    Array.isArray(v.hashtags)
  );
}

export interface ApprovalSource {
  title: string;
  url?: string;
  note?: string;
}

export function readSources(json: unknown): ApprovalSource[] {
  return Array.isArray(json)
    ? (json as ApprovalSource[]).filter((s) => typeof s?.title === "string")
    : [];
}
