#!/usr/bin/env node
// Creates (or updates) the single owner account and registers it in public.users.
//
// Run this ONCE from your own computer — never from the web app. It needs the Supabase
// service-role key, which must never be placed in the app's environment or committed.
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   OWNER_EMAIL=you@example.com \
//   node scripts/create-owner.mjs
//
// The password is read interactively (not echoed). Public sign-up stays disabled.
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
const displayName = process.env.OWNER_DISPLAY_NAME ?? "";
if (!url || !serviceKey || !email) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OWNER_EMAIL.");
  process.exit(2);
}

async function askPassword() {
  if (process.env.OWNER_PASSWORD) return process.env.OWNER_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => {
    if (s.includes("Owner password")) rl.output.write(s);
  };
  const pw = await new Promise((resolve) => rl.question("Owner password (min 12 chars, letters and digits): ", resolve));
  rl.close();
  process.stdout.write("\n");
  return pw;
}

const password = await askPassword();
if (password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
  console.error("Password must be at least 12 characters and include letters and digits.");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

let userId;
for (let page = 1; !userId; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  userId = data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id;
  if (data.users.length < 200) break;
}

if (userId) {
  const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (error) throw error;
  console.log("Updated existing owner account password.");
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  console.log("Created owner account.");
}

const { error: upsertErr } = await admin
  .from("users")
  .upsert({ id: userId, email, display_name: displayName, role: "owner", active: true }, { onConflict: "id" });
if (upsertErr) throw upsertErr;
console.log(`Owner registered in public.users (${email}). Set OWNER_EMAIL=${email} in the app environment.`);
