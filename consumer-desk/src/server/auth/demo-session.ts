import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DEMO_OWNER } from "../store/demo-seed";

/**
 * Demo-only session cookie. The signing key is generated per server process, so every demo
 * session ends when the server restarts (together with the in-memory demo data).
 * This cookie is only ever honoured when demoLoginAllowed() is true.
 */
export const DEMO_COOKIE = "cd_demo_session";
export const DEMO_OWNER_ID = DEMO_OWNER.id;
export const DEMO_OWNER_EMAIL = DEMO_OWNER.email;
const TTL_SECONDS = 8 * 60 * 60;

const g = globalThis as unknown as { __cdDemoKey?: Buffer };
function key(): Buffer {
  if (!g.__cdDemoKey) g.__cdDemoKey = randomBytes(32);
  return g.__cdDemoKey;
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function issueDemoToken(now = Date.now()): { token: string; maxAge: number } {
  const payload = Buffer.from(JSON.stringify({ sub: DEMO_OWNER_ID, exp: Math.floor(now / 1000) + TTL_SECONDS })).toString(
    "base64url",
  );
  return { token: `${payload}.${sign(payload)}`, maxAge: TTL_SECONDS };
}

export function verifyDemoToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    return data.sub === DEMO_OWNER_ID && typeof data.exp === "number" && data.exp * 1000 > now;
  } catch {
    return false;
  }
}
