/**
 * Transform raw Tapfiliate pulls into src/data/live-snapshot.json — the
 * real-data snapshot the frontend's snapshot mode renders.
 *
 * Privacy: output carries NO emails, phones, addresses or customer data.
 * Public display names are derived as "First L."; the Tapfiliate id remains
 * for admin identification. The output file is git-ignored (real business
 * data stays out of source control).
 *
 * Counting policy (snapshot mode — confirm before production activation):
 *   - a conversion recorded by the Sellavi→Tapfiliate integration counts as
 *     verified checkout revenue;
 *   - conversions whose direct ("regular") commission is dis-approved in
 *     Tapfiliate are EXCLUDED (test/cancelled orders);
 *   - the source reports one amount per conversion — no tax/shipping split.
 *
 * Usage:
 *   node scripts/build-snapshot.mjs <raw-affiliates.json> <raw-conversions.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function deriveDisplayName(firstname, lastname) {
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const initial = (lastname ?? "").trim()[0];
  return `${cap((firstname ?? "").trim())}${initial ? ` ${initial.toUpperCase()}.` : ""}`.trim() || "Affiliate";
}

export function transform(rawAffiliates, rawConversions, generatedAt = new Date().toISOString()) {
  const affiliates = rawAffiliates.map((a) => ({
    id: a.id,
    displayName: deriveDisplayName(a.firstname, a.lastname),
    enrolledAt: new Date(a.created_at).toISOString(),
    parentId: a.parent_id ?? null,
  }));

  const known = new Set(affiliates.map((a) => a.id));
  const conversions = [];
  const orphans = [];
  for (const c of rawConversions) {
    const affiliateId = c.affiliate?.id ?? null;
    if (!affiliateId || !known.has(affiliateId)) {
      orphans.push(c.id);
      continue;
    }
    const regular = (c.commissions ?? []).find((k) => k.kind === "regular");
    const disapproved = regular?.approved === false;
    conversions.push({
      id: `tap-${c.id}`,
      // Raw external id kept verbatim for stability; display ref tidies the
      // occasionally doubled "SELLAVI-" prefix seen in the live account.
      externalId: String(c.external_id ?? c.id),
      orderRef: `#${String(c.external_id ?? c.id).replace(/^(SELLAVI-)+/, "SELLAVI-")}`,
      affiliateId,
      occurredAt: new Date(c.created_at).toISOString(),
      amountCents: Math.round(Number(c.amount) * 100),
      excluded: disapproved,
      excludedReason: disapproved ? "commission_disapproved" : null,
    });
  }

  return {
    version: 1,
    generatedAt,
    source: "Tapfiliate (Claude connector) · program aactivatedrx",
    policyNote:
      "Counting Sellavi-tracked checkout revenue; conversions dis-approved in Tapfiliate are excluded. The source reports one amount per order (no tax/shipping split). Payment-verification gating for manual/Zelle orders activates with the production deploy.",
    affiliates,
    conversions,
    orphanConversionIds: orphans,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain && process.argv.length >= 4) {
  const rawAffiliates = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
  const rawConversions = JSON.parse(readFileSync(resolve(process.argv[3]), "utf8"));
  const out = transform(rawAffiliates, rawConversions);
  const dest = resolve(process.cwd(), "src/data/live-snapshot.json");
  writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(
    `wrote ${dest}: ${out.affiliates.length} affiliates, ${out.conversions.length} conversions` +
      (out.orphanConversionIds.length ? `, ${out.orphanConversionIds.length} orphaned (unknown affiliate)` : ""),
  );
}
