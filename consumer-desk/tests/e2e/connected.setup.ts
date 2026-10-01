import { createClient } from "@supabase/supabase-js";

/** Creates the local test owner (and a non-owner account) in the LOCAL Supabase stack only. */
export default async function globalSetup() {
  const url = process.env.SUPABASE_TEST_URL;
  const service = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  if (!url || !service || !email || !password) throw new Error("Run via `npm run test:e2e:connected` (needs local Supabase).");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error("Connected e2e tests only run against a local Supabase stack.");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const [addr, isOwner] of [
    [email, true],
    [`intruder-${email}`, false],
  ] as const) {
    let id = data.users.find((u) => u.email === addr)?.id;
    if (id) await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
    else id = (await admin.auth.admin.createUser({ email: addr, password, email_confirm: true })).data.user!.id;
    if (isOwner) {
      const { error } = await admin.from("users").upsert({ id, email: addr, role: "owner", active: true, display_name: "E2E Owner" });
      if (error) throw error;
    }
  }
}
