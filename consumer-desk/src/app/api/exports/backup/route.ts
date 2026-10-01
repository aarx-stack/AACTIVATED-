import { requireOwnerForRoute } from "@/server/context";
import { errorJson, jsonDownload, sameOrigin } from "@/server/http";
import { exportAll } from "@/server/services/timeline";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorJson(403, "Cross-site request rejected");
  const ctx = await requireOwnerForRoute();
  if (ctx instanceof Response) return ctx;
  return jsonDownload(await exportAll(ctx), `consumer-desk-backup-${new Date().toISOString().slice(0, 10)}.json`);
}
