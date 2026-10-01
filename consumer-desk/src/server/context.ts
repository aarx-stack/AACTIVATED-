import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { demoLoginAllowed, getConfig, resolveMailPolicy } from "./config";
import { DEMO_COOKIE, DEMO_OWNER_EMAIL, DEMO_OWNER_ID, verifyDemoToken } from "./auth/demo-session";
import { getDemoStore } from "./store/demo-instance";
import { SupabaseStore } from "./store/supabase-store";
import type { Store } from "./store/types";
import { createSupabaseServerClient } from "./supabase/server";
import { log } from "./log";
import type { Ctx, OwnerIdentity } from "./services/ctx";

export type { Ctx, OwnerIdentity };

export type AuthState =
  | { status: "ok"; ctx: Ctx }
  | { status: "mfa_enrollment_required"; ctx: Ctx }
  | { status: "anonymous" }
  | { status: "mfa_required" }
  | { status: "forbidden"; reason: string }
  | { status: "misconfigured"; problems: string[] }
  | { status: "unavailable" };

async function timezoneFor(store: Store, ownerId: string): Promise<string> {
  const settings = await store.getSettings(ownerId);
  return settings?.timezone || "America/Los_Angeles";
}

/** Resolves who is calling. Never throws for auth problems and never falls back to demo data. */
export async function resolveAuth(): Promise<AuthState> {
  const config = getConfig();
  const policy = resolveMailPolicy(config);
  if (config.dataMode === "invalid") return { status: "misconfigured", problems: config.problems };

  if (config.dataMode === "demo") {
    const host = (await headers()).get("host");
    if (!demoLoginAllowed(config, host)) {
      return {
        status: "forbidden",
        reason: "Demo mode is restricted to local development on a loopback address.",
      };
    }
    const token = (await cookies()).get(DEMO_COOKIE)?.value;
    if (!verifyDemoToken(token)) return { status: "anonymous" };
    const store = await getDemoStore();
    return {
      status: "ok",
      ctx: {
        store,
        owner: { id: DEMO_OWNER_ID, email: DEMO_OWNER_EMAIL, displayName: "Demo Owner (fictional)" },
        config,
        policy,
        timezone: await timezoneFor(store, DEMO_OWNER_ID),
        isDemo: true,
      },
    };
  }

  if (config.problems.length > 0) return { status: "misconfigured", problems: config.problems };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { status: "anonymous" };
    const user = data.user;
    if ((user.email ?? "").toLowerCase() !== config.ownerEmail) {
      return { status: "forbidden", reason: "This account is not the configured owner." };
    }
    const { data: ownerRow, error: ownerErr } = await supabase
      .from("users")
      .select("id, email, display_name, role, active")
      .eq("id", user.id)
      .maybeSingle();
    if (ownerErr) {
      log.warn("owner lookup failed", { code: ownerErr.code });
      return { status: "unavailable" };
    }
    if (!ownerRow || ownerRow.role !== "owner" || !ownerRow.active) {
      return {
        status: "forbidden",
        reason: "The owner account exists in Auth but is not registered in public.users. Run the owner setup script.",
      };
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") return { status: "mfa_required" };

    const store = new SupabaseStore(supabase);
    const ctx: Ctx = {
      store,
      owner: { id: user.id, email: user.email ?? "", displayName: ownerRow.display_name || user.email || "Owner" },
      config,
      policy,
      timezone: await timezoneFor(store, user.id),
      isDemo: false,
    };
    if (config.requireMfa && aal?.currentLevel !== "aal2") return { status: "mfa_enrollment_required", ctx };
    return { status: "ok", ctx };
  } catch (err) {
    log.error("auth resolution failed", { name: (err as Error).name });
    return { status: "unavailable" };
  }
}

/** For pages and server actions. Redirects instead of rendering anything protected. */
export async function requireOwner(options: { allowMfaEnrollment?: boolean } = {}): Promise<Ctx> {
  const state = await resolveAuth();
  switch (state.status) {
    case "ok":
      return state.ctx;
    case "mfa_enrollment_required":
      if (options.allowMfaEnrollment) return state.ctx;
      redirect("/settings/security?required=1");
    case "mfa_required":
      redirect("/login/mfa");
    case "anonymous":
      redirect("/login");
    case "forbidden":
      redirect(`/login?error=forbidden`);
    case "misconfigured":
      redirect(`/login?error=config`);
    case "unavailable":
      redirect(`/login?error=unavailable`);
  }
}

/** For route handlers: returns a Ctx or a JSON error response (401/403/503). */
export async function requireOwnerForRoute(): Promise<Ctx | Response> {
  const state = await resolveAuth();
  if (state.status === "ok") return state.ctx;
  const status =
    state.status === "anonymous" || state.status === "mfa_required" || state.status === "mfa_enrollment_required"
      ? 401
      : state.status === "forbidden"
        ? 403
        : 503;
  return Response.json(
    { error: status === 401 ? "Authentication required" : status === 403 ? "Forbidden" : "Unavailable" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
