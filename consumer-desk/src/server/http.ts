import "server-only";

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

/** Rejects cross-site POSTs to route handlers (server actions have this built in). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function fileResponse(bytes: Uint8Array, contentType: string, filename: string, download: boolean): Response {
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "file";
  return new Response(new Blob([new Uint8Array(bytes)], { type: contentType }), {
    headers: {
      ...NO_STORE,
      "Content-Type": contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safe}"`,
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
    },
  });
}

export function jsonDownload(data: unknown, filename: string): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { ...NO_STORE, "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}

export function errorJson(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}
