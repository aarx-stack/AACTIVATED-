import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getConfig } from "../config";

/**
 * Supabase client bound to the current request's auth cookies. Uses only the public anon key;
 * every query runs as the signed-in user, so row-level security is always applied.
 * The service-role key is never used by the web application.
 */
export async function createSupabaseServerClient() {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
  }
  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, { ...options, httpOnly: true, sameSite: "lax" });
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes
          // sessions, so this is safe to ignore.
        }
      },
    },
  });
}
