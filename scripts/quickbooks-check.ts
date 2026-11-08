/**
 * `npm run quickbooks:check`: is this machine ready for "Connect QuickBooks"?
 *
 * Offline: reads the environment and the local database only. It never contacts Intuit and
 * never prints a secret value.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { parseEncryptionKey } from "@/server/crypto/secrets";
import { oauthMissing, quickBooksRedirectUri } from "@/server/integrations/quickbooks-connection";

const ok = (text: string) => console.log(`  [ok]   ${text}`);
const todo = (text: string) => console.log(`  [todo] ${text}`);

async function main() {
  let env;
  try {
    env = getEnv();
  } catch (error) {
    console.log("The environment is not valid yet:\n");
    console.log(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  console.log("Connect QuickBooks: readiness check (nothing is sent to Intuit)\n");
  let ready = true;

  if (env.INTEGRATION_QUICKBOOKS === "live") ok("INTEGRATION_QUICKBOOKS=live");
  else {
    ready = false;
    todo("Set INTEGRATION_QUICKBOOKS=live (it is mock, so the app never calls QuickBooks).");
  }

  console.log(
    `  [info] QUICKBOOKS_ENVIRONMENT=${env.QUICKBOOKS_ENVIRONMENT}` +
      (env.QUICKBOOKS_ENVIRONMENT === "sandbox"
        ? " (Intuit test company: use the app's Development keys)"
        : " (your real company: use the app's Production keys)"),
  );

  const missing = oauthMissing(env);
  for (const name of ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"] as const) {
    if (missing.includes(name)) {
      ready = false;
      todo(`Set ${name} (Intuit developer portal: your app, Keys and credentials).`);
    } else ok(`${name} is set`);
  }
  if (missing.includes("TOKEN_ENCRYPTION_KEY")) {
    ready = false;
    todo("Set TOKEN_ENCRYPTION_KEY. Generate one with: npm run secret");
  } else {
    try {
      parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
      ok("TOKEN_ENCRYPTION_KEY is a valid 32-byte key");
    } catch (error) {
      ready = false;
      todo(error instanceof Error ? error.message : "TOKEN_ENCRYPTION_KEY is not valid.");
    }
  }

  const redirect = quickBooksRedirectUri(env);
  console.log(`\n  Register this Redirect URI in the Intuit app, exactly:\n    ${redirect}`);
  if (env.QUICKBOOKS_ENVIRONMENT === "production" && !redirect.startsWith("https://")) {
    ready = false;
    todo("Production keys need an https address: set APP_URL to the hosted https address.");
  }

  try {
    const connection = await db.integrationConnection.findUnique({
      where: { provider: "QUICKBOOKS" },
      select: { accountId: true, connectedAt: true, refreshExpiresAt: true },
    });
    console.log(
      connection
        ? `\n  Connected to company ${connection.accountId} since ${connection.connectedAt.toISOString().slice(0, 10)}.`
        : "\n  Not connected yet.",
    );
  } catch {
    console.log("\n  Could not read the local database (is Postgres running?).");
  }

  console.log(
    ready
      ? "\nReady. Start the app, sign in as Isaac or Guy, open Admin and click Connect QuickBooks."
      : "\nNot ready yet: finish the [todo] items above, then run this again.",
  );
  if (!ready) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
