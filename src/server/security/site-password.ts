/**
 * An optional password in front of the whole site (SITE_PASSWORD), for a staging copy that should
 * not be open to anyone with the link. The browser asks once (HTTP Basic auth; any user name).
 * Production relies on sign-in instead and normally leaves it unset.
 */

/** Paths that must work without the site password. */
export function isPublicPath(path: string) {
  return (
    path === "/api/health" ||
    path === "/unsubscribe" ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/icons/")
  );
}

function sameText(a: string, b: string) {
  // Constant-time comparison without Node-only APIs (the proxy may run on the edge).
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** True when the Authorization header carries the site password. */
export function hasSitePassword(header: string | null, password: string) {
  if (!header?.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const given = decoded.slice(decoded.indexOf(":") + 1);
  return decoded.includes(":") && sameText(given, password);
}
