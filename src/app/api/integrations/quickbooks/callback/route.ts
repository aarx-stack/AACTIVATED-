import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import {
  exchangeCode,
  oauthConfigured,
  saveConnection,
  STATE_COOKIE,
} from "@/server/integrations/quickbooks-connection";

function sameValue(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Intuit sends the admin back here with a one-time code; it is exchanged and stored encrypted. */
export async function GET(request: NextRequest) {
  const env = getEnv();
  const back = (outcome: string) => {
    const response = NextResponse.redirect(new URL(`/admin?qb=${outcome}`, request.url));
    response.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/api/integrations/quickbooks" });
    return response;
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!can(user.role, "integrations.connect_accounting")) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }
  if (env.INTEGRATION_QUICKBOOKS !== "live" || !oauthConfigured(env)) return back("not_configured");

  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!state || !expected || !sameValue(`${state}.${user.id}`, expected)) return back("expired");
  if (params.get("error")) return back("denied");

  const code = params.get("code");
  const realmId = params.get("realmId");
  if (!code || !realmId) return back("error");

  try {
    const tokens = await exchangeCode(code, env);
    await saveConnection(user, realmId, tokens, { env });
  } catch (error) {
    console.error("[quickbooks] connect failed:", error instanceof Error ? error.message : error);
    return back("error");
  }
  return back("connected");
}
