export type DataMode = "demo" | "live";

/**
 * Demo is the default for this build. Live mode is only meaningful once the
 * Worker API is deployed with real credentials (see docs/SETUP.md); switching
 * the flag never grants access — the server enforces auth on every endpoint.
 */
export const DATA_MODE: DataMode =
  (import.meta.env.VITE_DATA_MODE as DataMode | undefined) ?? "demo";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
