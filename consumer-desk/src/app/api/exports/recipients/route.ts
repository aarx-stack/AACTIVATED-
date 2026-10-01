import { requireOwnerForRoute } from "@/server/context";
import { errorJson, sameOrigin } from "@/server/http";
import { recipientCsv } from "@/server/services/timeline";
import { uuid } from "@/server/services/validation";

export const dynamic = "force-dynamic";

/** Generic recipient CSV (NOT a verified LetterStream import format). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorJson(403, "Cross-site request rejected");
  const ctx = await requireOwnerForRoute();
  if (ctx instanceof Response) return ctx;
  const form = await request.formData();
  const ids = form.getAll("packet_id").map(String).filter((s) => uuid.safeParse(s).success);
  if (ids.length === 0) return errorJson(400, "No packets selected");
  const csv = await recipientCsv(ctx, ids);
  return new Response(csv, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="recipients-generic.csv"`,
    },
  });
}
