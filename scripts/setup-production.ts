/**
 * `npm run setup:production`: sets up the real company in a new, empty database.
 * No demo data. Safe to run again: it only adds what is missing.
 *
 * Needs: DATABASE_URL (migrated with `npm run db:deploy`), and
 *   SETUP_EXECUTIVE_NAME, SETUP_EXECUTIVE_EMAIL, SETUP_ADMIN_NAME, SETUP_ADMIN_EMAIL,
 *   optionally SETUP_AI_BUDGET_USD (monthly company AI budget, default 200).
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { setupProduction } from "@/server/setup/production";

async function main() {
  const env = getEnv();
  const result = await setupProduction(db, {
    executiveName: process.env.SETUP_EXECUTIVE_NAME ?? "",
    executiveEmail: process.env.SETUP_EXECUTIVE_EMAIL ?? "",
    adminName: process.env.SETUP_ADMIN_NAME ?? "",
    adminEmail: process.env.SETUP_ADMIN_EMAIL ?? "",
    aiBudgetUsd: process.env.SETUP_AI_BUDGET_USD || undefined,
  });
  const created = Object.entries(result.created);
  console.log("Production setup complete.");
  console.log(
    created.length
      ? `Created: ${created.map(([k, n]) => `${n} ${k}`).join(", ")}.`
      : "Nothing was missing; nothing changed.",
  );
  console.log(`\nNext:`);
  console.log(
    `  1. ${result.executive.name} and ${result.admin.name} sign in at ${env.APP_URL}/login with their email.`,
  );
  console.log(
    "  2. Review the starter compliance rules (Approvals > Content rules): they are placeholders.",
  );
  console.log("  3. Invite the team from Admin. Each staff member gets a personal assistant.");
  console.log("  4. Add department budgets in Finance & Budget > New budget.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
