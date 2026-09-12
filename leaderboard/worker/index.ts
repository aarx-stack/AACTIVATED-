/**
 * AACTIVATED RX affiliate leaderboard — Cloudflare Worker entry.
 * Serves the SPA (static assets) and the /api routes, and runs scheduled
 * reconciliation + snapshot jobs. Deliberately separate from the existing
 * storefront, checkout, PayPal Worker, DNS and Tapfiliate tracking scripts.
 */
import { router } from "./routes";
import { errorResponse, json } from "./lib/http";
import { reconcile, snapshotLeaderboards } from "./jobs/reconcile";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // Secrets (wrangler secret put …) — never exposed to the frontend.
  TAPFILIATE_API_KEY?: string;
  TAPFILIATE_WEBHOOK_SECRET?: string;
  SELLAVI_API_KEY?: string;
  // Cloudflare Access config (vars).
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // "1" enables the public read-only leaderboard (option A); unset keeps every
  // endpoint behind auth.
  PUBLIC_BOARD?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        const matched = router.match(req, env);
        if (matched) return await matched;
        return json({ error: "not_found" }, 404);
      } catch (e) {
        return errorResponse(e);
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // "0 10 * * *" = daily snapshot (≈2–3 AM Pacific); every-15-min = reconcile.
    if (controller.cron === "0 10 * * *") {
      ctx.waitUntil(snapshotLeaderboards(env));
    } else {
      ctx.waitUntil(reconcile(env));
    }
  },
} satisfies ExportedHandler<Env>;
