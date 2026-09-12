/**
 * Public display name: "First L." — publication-safe, derived from the raw
 * Tapfiliate first/last name. Used by the Worker import and the snapshot
 * transform so demo, snapshot and live all render names identically.
 * A full last name or email is never exposed publicly.
 */
export function deriveDisplayName(firstname: string | null | undefined, lastname: string | null | undefined): string {
  const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : "");
  const first = cap((firstname ?? "").trim());
  const initial = (lastname ?? "").trim()[0];
  const name = `${first}${initial ? ` ${initial.toUpperCase()}.` : ""}`.trim();
  return name || "Affiliate";
}
