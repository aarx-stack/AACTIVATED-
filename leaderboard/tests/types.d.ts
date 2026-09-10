/**
 * Test-config typing shims. The app compiles with vite/client (which types
 * import.meta.env/glob); the node test config compiles the same sources, so
 * these declarations fill the same shape there. Runtime behavior comes from
 * Vite's build-time substitution either way.
 */
interface ImportMeta {
  env?: Record<string, string | undefined>;
  glob(pattern: string, opts: { eager: true }): Record<string, unknown>;
}

/** Typing shim for the plain-JS snapshot transform used in tests. */
declare module "*/build-snapshot.mjs" {
  export function deriveDisplayName(firstname: string | null, lastname: string | null): string;
  export function transform(
    rawAffiliates: unknown[],
    rawConversions: unknown[],
    generatedAt?: string,
  ): import("../src/data/snapshot").SnapshotFile;
}
