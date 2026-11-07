/**
 * Rebuilds the TEST database from migrations before the integration suite.
 * Refuses to touch any database whose name does not end in "_test".
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/aactivated_test?schema=public";
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to reset "${dbName}": integration tests only run against a *_test database.`,
    );
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
