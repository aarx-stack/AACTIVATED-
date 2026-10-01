import { requireOwnerForRoute } from "@/server/context";
import { errorJson, fileResponse } from "@/server/http";
import { getDocumentFile } from "@/server/services/documents";

export const dynamic = "force-dynamic";

/** Authenticated document download. There are no public URLs for stored files. */
export async function GET(request: Request, ctxArg: RouteContext<"/api/documents/[id]">) {
  const ctx = await requireOwnerForRoute();
  if (ctx instanceof Response) return ctx;
  const { id } = await ctxArg.params;
  const file = await getDocumentFile(ctx, id).catch(() => null);
  if (!file) return errorJson(404, "Not found");
  const download = new URL(request.url).searchParams.get("download") === "1";
  return fileResponse(file.bytes, file.row.mime_type, file.row.original_filename, download);
}
