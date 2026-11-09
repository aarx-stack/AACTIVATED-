import { type NextRequest, NextResponse } from "next/server";
import { hasSitePassword, isPublicPath } from "@/server/security/site-password";

/** With SITE_PASSWORD set, the whole site asks for it first (staging copies). */
export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password || isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  if (hasSitePassword(request.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("This site needs its password.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AACTIVATED AI Brain", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
