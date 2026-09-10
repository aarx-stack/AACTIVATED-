export type DataMode = "demo" | "snapshot" | "live";

/**
 * demo     — fictional dataset (default).
 * snapshot — real Tapfiliate data from the git-ignored live-snapshot.json,
 *            read-only, point-in-time (falls back to demo if the file is absent).
 * live     — Worker API with real credentials (see docs/SETUP.md).
 * Switching the flag never grants access — the server enforces auth on every
 * endpoint, and snapshot bundles contain no credentials.
 *
 * NOTE: `import.meta.env` must stay a literal expression — Vite substitutes
 * it statically at build time (tests/types.d.ts types it for the node config).
 */
export const DATA_MODE: DataMode =
  (import.meta.env?.VITE_DATA_MODE as DataMode | undefined) ?? "demo";

export const API_BASE = import.meta.env?.VITE_API_BASE ?? "/api";
