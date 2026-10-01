import { requireOwnerForRoute } from "@/server/context";
import { errorJson, fileResponse } from "@/server/http";
import { renderDraftLetterPdf } from "@/server/services/packets";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";

/** "Generate PDF": renders the current draft letter (without attachments) on the server. */
export async function GET(request: Request, ctxArg: RouteContext<"/api/letters/[id]/pdf">) {
  const ctx = await requireOwnerForRoute();
  if (ctx instanceof Response) return ctx;
  const { id } = await ctxArg.params;
  if (!uuid.safeParse(id).success) return errorJson(404, "Not found");
  const letter = await ctx.store.get("letters", id);
  if (!letter) return errorJson(404, "Not found");
  const bytes = await renderDraftLetterPdf(ctx, letter);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return fileResponse(bytes, "application/pdf", `letter-draft-${id.slice(0, 8)}.pdf`, download);
}
