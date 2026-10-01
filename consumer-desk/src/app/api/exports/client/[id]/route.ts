import { requireOwnerForRoute } from "@/server/context";
import { errorJson, jsonDownload, sameOrigin } from "@/server/http";
import { exportClient } from "@/server/services/clients";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctxArg: RouteContext<"/api/exports/client/[id]">) {
  if (!sameOrigin(request)) return errorJson(403, "Cross-site request rejected");
  const ctx = await requireOwnerForRoute();
  if (ctx instanceof Response) return ctx;
  const { id } = await ctxArg.params;
  const data = await exportClient(ctx, id).catch(() => null);
  if (!data) return errorJson(404, "Not found");
  return jsonDownload(data, `client-export-${id.slice(0, 8)}.json`);
}
