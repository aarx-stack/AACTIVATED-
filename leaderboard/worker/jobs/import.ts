import type { SqlDb } from "../lib/db";
import { nowIso } from "../lib/db";
import type { TapfiliateClient, TapAffiliate } from "../adapters/tapfiliate";
import { deriveDisplayName } from "@shared/names";

/**
 * Import affiliates + team hierarchy from Tapfiliate (the attribution
 * authority). Affiliate id in D1 IS the Tapfiliate id, so conversions map by
 * identity. Names are stored as the publication-safe "First L." form and
 * marked approved (the same form already shown on the shared board). MLM
 * parent→child links become verified team edges (Tapfiliate is the source of
 * truth for them); an admin can still un-verify an edge, which drops it from
 * team rollups.
 */
export async function importAffiliates(
  db: SqlDb,
  client: TapfiliateClient,
): Promise<{ affiliates: number; edges: number }> {
  const all: TapAffiliate[] = [];
  for await (const page of client.listAffiliates()) all.push(...page);

  const known = new Set(all.map((a) => a.id));
  let affiliates = 0;
  let edges = 0;

  for (const a of all) {
    await db.run(
      `INSERT INTO affiliates (id, tapfiliate_id, display_name, display_name_approved, status, enrolled_at)
       VALUES (?1, ?1, ?2, 1, 'active', ?3)
       ON CONFLICT (id) DO UPDATE SET
         tapfiliate_id = excluded.tapfiliate_id,
         display_name  = excluded.display_name,
         enrolled_at   = excluded.enrolled_at,
         updated_at    = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      a.id,
      deriveDisplayName(a.firstname, a.lastname),
      normalizeEnrolledAt(a),
    );
    affiliates++;
  }

  // Second pass: edges (parents must exist as affiliates → FK-safe).
  for (const a of all) {
    if (!a.parent_id || !known.has(a.parent_id)) continue;
    await db.run(
      `INSERT INTO team_edges (parent_id, child_id, source, verified, verified_at, verified_by)
       VALUES (?1, ?2, 'tapfiliate_mlm', 1, ?3, 'tapfiliate_import')
       ON CONFLICT (child_id) DO UPDATE SET
         parent_id = excluded.parent_id,
         source    = excluded.source`,
      a.parent_id,
      a.id,
      nowIso(),
    );
    edges++;
  }

  return { affiliates, edges };
}

function normalizeEnrolledAt(a: TapAffiliate): string {
  const raw = (a as unknown as { created_at?: string }).created_at;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
}
