"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { DEMO_COOKIE, issueDemoToken } from "@/server/auth/demo-session";
import { demoLoginAllowed, getConfig } from "@/server/config";
import { requireOwner } from "@/server/context";
import { log } from "@/server/log";
import { rateLimit } from "@/server/rate-limit";
import { recordAudit } from "@/server/services/audit";
import { createSupabaseServerClient } from "@/server/supabase/server";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const config = getConfig();
  const h = await headers();
  if (!rateLimit(`login:${await clientIp()}`, 8, 15 * 60_000)) {
    return { status: "error", message: "Too many sign-in attempts. Wait 15 minutes and try again." };
  }

  if (config.dataMode === "demo") {
    if (!demoLoginAllowed(config, h.get("host"))) {
      return { status: "error", message: "Demo sign-in is only available on localhost during local development." };
    }
    const { token, maxAge } = issueDemoToken();
    (await cookies()).set(DEMO_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge,
    });
    redirect("/");
  }

  if (config.dataMode !== "supabase" || config.problems.length > 0) {
    return { status: "error", message: "The application is not configured. See the README setup steps." };
  }

  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const generic = { status: "error" as const, message: "Sign-in failed. Check your email and password." };
  if (!email || !password) return generic;
  // Only the configured owner may sign in. (Public sign-up is disabled in Supabase.)
  if (email !== config.ownerEmail) return generic;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    log.warn("sign-in rejected", { code: error.code ?? "auth" });
    return generic;
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/login/mfa");
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const config = getConfig();
  if (config.dataMode === "demo") {
    (await cookies()).delete(DEMO_COOKIE);
  } else if (config.dataMode === "supabase" && config.problems.length === 0) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function mfaVerifyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const config = getConfig();
  if (config.dataMode !== "supabase") redirect("/login");
  if (!rateLimit(`mfa:${await clientIp()}`, 10, 15 * 60_000)) {
    return { status: "error", message: "Too many attempts. Wait 15 minutes." };
  }
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { status: "error", message: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user || (userData.user.email ?? "").toLowerCase() !== config.ownerEmail) redirect("/login");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) return { status: "error", message: "No verified authenticator is enrolled." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { status: "error", message: "That code was not accepted." };
  redirect("/");
}

export interface EnrollState {
  status: "idle" | "enrolling" | "error" | "done";
  message: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

export async function startMfaEnrollment(): Promise<EnrollState> {
  const ctx = await requireOwner({ allowMfaEnrollment: true });
  if (ctx.isDemo) return { status: "error", message: "MFA applies to the connected app only (demo mode has no real accounts)." };
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) {
    if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Consumer Desk ${Date.now()}` });
  if (error || !data) return { status: "error", message: "Could not start enrollment. Is TOTP MFA enabled in Supabase Auth?" };
  return { status: "enrolling", message: "", factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function finishMfaEnrollment(factorId: string, code: string): Promise<EnrollState> {
  const ctx = await requireOwner({ allowMfaEnrollment: true });
  if (ctx.isDemo) return { status: "error", message: "Not available in demo mode." };
  if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) return { status: "error", message: "Enter the 6-digit code.", factorId };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
  if (error) return { status: "error", message: "The code was not accepted. Try again.", factorId };
  // The session is now aal2; use a fresh context so the audit insert passes the aal2 policy.
  const upgraded = await requireOwner({ allowMfaEnrollment: true });
  await recordAudit(upgraded, {
    action: "security.mfa_enrolled",
    record_type: "user",
    summary: "Authenticator app (TOTP) enrolled",
  }).catch(() => log.warn("mfa audit insert failed", { operation: "mfa_enroll" }));
  return { status: "done", message: "Authenticator enrolled. Future sign-ins require a code." };
}
