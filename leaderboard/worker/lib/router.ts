export interface RouteCtx<E> {
  req: Request;
  env: E;
  params: Record<string, string>;
  url: URL;
}

type Handler<E> = (ctx: RouteCtx<E>) => Promise<Response> | Response;

interface Route<E> {
  method: string;
  parts: string[];
  handler: Handler<E>;
}

export class Router<E> {
  private routes: Route<E>[] = [];

  on(method: string, pattern: string, handler: Handler<E>): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  get(p: string, h: Handler<E>) { return this.on("GET", p, h); }
  post(p: string, h: Handler<E>) { return this.on("POST", p, h); }
  put(p: string, h: Handler<E>) { return this.on("PUT", p, h); }

  match(req: Request, env: E): Promise<Response> | Response | null {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== req.method || r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const p = r.parts[i]!;
        if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(parts[i]!);
        else if (p !== parts[i]) { ok = false; break; }
      }
      if (ok) return r.handler({ req, env, params, url });
    }
    return null;
  }
}
