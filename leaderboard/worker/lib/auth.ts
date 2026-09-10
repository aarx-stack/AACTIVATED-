/**
 * Authentication: Cloudflare Access in front of the app; this module verifies
 * the `Cf-Access-Jwt-Assertion` JWT (RS256 against the team's published
 * certs) and resolves the identity to an affiliate/role through the
 * server-side auth_users table. The client never supplies a role.
 *
 * FAIL CLOSED: if Access isn't configured, every protected endpoint returns
 * 503 — there is no demo bypass and no header-based shortcut.
 */
import { HttpError } from "./http";
import type { SqlDb } from "./db";

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export interface Identity {
  subject: string;
  email: string | null;
  role: "affiliate" | "admin";
  affiliateId: string | null;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

const certCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const CERT_TTL_MS = 60 * 60 * 1000;

async function fetchCerts(teamDomain: string): Promise<Jwk[]> {
  const cached = certCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < CERT_TTL_MS) return cached.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, "auth_certs_unavailable", "Cannot fetch Access certs");
  const body = (await res.json()) as { keys: Jwk[] };
  certCache.set(teamDomain, { keys: body.keys, fetchedAt: Date.now() });
  return body.keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

interface AccessClaims {
  aud: string[] | string;
  iss: string;
  exp: number;
  iat: number;
  sub: string;
  email?: string;
}

export async function verifyAccessJwt(token: string, env: AuthEnv): Promise<AccessClaims> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) {
    throw new HttpError(503, "auth_not_configured", "Authentication is not configured");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "bad_token");
  const [h, p, s] = parts as [string, string, string];

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new HttpError(401, "bad_token_alg");

  const keys = await fetchCerts(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, "unknown_key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s) as unknown as ArrayBuffer,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new HttpError(401, "invalid_signature");

  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as AccessClaims;
  const audList = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audList.includes(aud)) throw new HttpError(401, "aud_mismatch");
  if (claims.iss !== `https://${teamDomain}`) throw new HttpError(401, "iss_mismatch");
  if (claims.exp * 1000 < Date.now()) throw new HttpError(401, "token_expired");
  return claims;
}

export async function authenticate(req: Request, env: AuthEnv, db: SqlDb): Promise<Identity> {
  // Configuration check first: an unconfigured deployment must fail closed
  // with a diagnosable 503 on every protected endpoint, token or not.
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new HttpError(503, "auth_not_configured", "Authentication is not configured");
  }
  const token =
    req.headers.get("Cf-Access-Jwt-Assertion") ??
    // Access also sets a cookie on browser navigations.
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get("Cookie") ?? "")?.[1] ??
    null;
  if (!token) throw new HttpError(401, "unauthenticated", "Sign-in required");

  const claims = await verifyAccessJwt(token, env);

  const row = await db.first<{ role: "affiliate" | "admin"; affiliate_id: string | null; email: string | null }>(
    "SELECT role, affiliate_id, email FROM auth_users WHERE provider = 'cloudflare_access' AND subject = ?1",
    claims.sub,
  );
  if (!row) {
    // Authenticated but not provisioned: an admin must map the identity to an
    // affiliate record first. Never auto-grant anything.
    throw new HttpError(403, "not_provisioned", "Account not provisioned for this program");
  }
  return {
    subject: claims.sub,
    email: row.email ?? claims.email ?? null,
    role: row.role,
    affiliateId: row.affiliate_id,
  };
}

export function requireAdmin(identity: Identity): void {
  if (identity.role !== "admin") throw new HttpError(403, "forbidden", "Admin access required");
}

export function requireAffiliate(identity: Identity): string {
  if (!identity.affiliateId) throw new HttpError(403, "no_affiliate", "No affiliate record linked");
  return identity.affiliateId;
}
