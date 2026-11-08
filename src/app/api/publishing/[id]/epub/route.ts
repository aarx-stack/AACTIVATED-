import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { buildEpub, fileNameFor } from "@/server/publishing/epub";
import { exportModel } from "@/server/publishing/service";

/** Downloads the publication as an EPUB e-book. Marked DRAFT unless approved and unchanged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "publishing.manage")) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  const { id } = await params;
  let book;
  try {
    book = await exportModel(user, id);
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const file = buildEpub(book, id);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${fileNameFor(book.title, book.final ? "epub" : "draft.epub")}"`,
      "Cache-Control": "no-store",
    },
  });
}
