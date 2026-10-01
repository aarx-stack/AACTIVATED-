#!/usr/bin/env node
// Runs a command with the LOCAL Supabase stack's URL/keys exported as environment variables.
// Usage: node scripts/with-local-supabase.mjs <command...>
// Keys are read from `supabase status` at run time and never written to disk.
import { execFileSync, spawn } from "node:child_process";

const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const status = JSON.parse(raw.slice(raw.indexOf("{")));
const env = {
  ...process.env,
  SUPABASE_TEST_URL: status.API_URL,
  SUPABASE_TEST_ANON_KEY: status.ANON_KEY,
  SUPABASE_TEST_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SUPABASE_TEST_DB_URL: status.DB_URL,
};
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-local-supabase.mjs <command...>");
  process.exit(2);
}
const child = spawn(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
