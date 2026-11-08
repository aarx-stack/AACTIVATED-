import { type NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import {
  buildAuthorizeUrl,
  newOAuthState,
  oauthConfigured,
  STATE_COOKIE,
} from "@/server/integrations/quickbooks-connection";

/** Starts "Connect QuickBooks": sends the signed-in admin or executive to Intuit to approve. */
export async function GET(request: NextRequest) {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!can(user.role, "integrations.connect_accounting")) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }
  if (env.INTEGRATION_QUICKBOOKS !== "live" || !oauthConfigured(env)) {
    return NextResponse.redirect(new URL("/admin?qb=not_configured", request.url));
  }
  const state = newOAuthState();
  const response = NextResponse.redirect(buildAuthorizeUrl(state, env));
  // Binds the round trip to this browser and this user; checked in the callback.
  response.cookies.set(STATE_COOKIE, `${state}.${user.id}`, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https://"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/integrations/quickbooks",
  });
  return response;
}
