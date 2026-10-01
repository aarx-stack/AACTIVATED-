import { requireOwnerForRoute } from "@/server/context";
import { errorJson, fileResponse } from "@/server/http";
import { getPacketPdf } from "@/server/services/packets";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctxArg: RouteContext<"/api/packets/[id]/pdf">) {
  const ctx = await requireOwnerForRoute();
  if (ctx instanceof Response) return ctx;
  const { id } = await ctxArg.params;
  const file = await getPacketPdf(ctx, id).catch(() => null);
  if (!file) return errorJson(404, "Not found");
  const download = new URL(request.url).searchParams.get("download") === "1";
  return fileResponse(file.bytes, "application/pdf", `packet-${file.packet.id.slice(0, 8)}.pdf`, download);
}
