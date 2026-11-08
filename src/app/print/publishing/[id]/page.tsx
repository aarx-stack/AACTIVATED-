import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/publishing/print-button";
import { requirePagePermission } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz/permissions";
import { exportModel, KIND_LABEL } from "@/server/publishing/service";

export const metadata: Metadata = { title: "Print" };

const PRINT_CSS = `
body{background:#fff !important;color:#111 !important}
body::before,body::after{display:none !important}
.book{max-width:720px;margin:0 auto;padding:48px 24px;font-family:Georgia,"Times New Roman",serif;line-height:1.6;font-size:17px}
.book h1{font-size:2.1em;line-height:1.2;margin:0 0 .3em}
.book h2{font-size:1.45em;margin:0 0 .8em;break-after:avoid}
.book p{margin:0 0 .9em}
.cover{min-height:60vh;display:flex;flex-direction:column;justify-content:center;text-align:center}
.cover .sub{font-size:1.2em;color:#444}.cover .by{margin-top:2em;color:#666}
.toc ol{padding-left:1.2em}.toc li{margin:.3em 0}
.part{break-before:page;padding-top:24px}
.draft{border:1px solid #b00;color:#b00;padding:6px 10px;font:13px/1.4 system-ui,sans-serif;margin:16px 0}
.bar{position:sticky;top:0;background:#f4f6fa;border-bottom:1px solid #dde;padding:10px 16px;display:flex;gap:12px;align-items:center;font:14px system-ui,sans-serif;color:#222}
@media print{.bar{display:none}.book{padding:0;max-width:none}@page{margin:22mm 20mm}}
`;

/** A clean, printable copy. "Save as PDF" in the browser's print dialog makes the PDF. */
export default async function PrintPublicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePagePermission("publishing.manage");
  const { id } = await params;
  let book;
  try {
    book = await exportModel(user, id);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
  const draft = !book.final;
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="bar">
        <PrintButton />
        <span>
          Choose &quot;Save as PDF&quot; as the printer.{" "}
          {draft
            ? "This copy is marked DRAFT: it is not approved for publishing."
            : "Approved version."}
        </span>
      </div>
      <article className="book" data-testid="print-book">
        <section className="cover">
          <h1>{book.title}</h1>
          {book.subtitle && <p className="sub">{book.subtitle}</p>}
          <p className="by">
            {KIND_LABEL[book.kind]} · {book.author}
          </p>
          {draft && (
            <p className="draft">DRAFT: not approved for publishing. Internal review copy.</p>
          )}
        </section>
        {book.sections.length > 1 && (
          <section className="toc part">
            <h2>Contents</h2>
            <ol>
              {book.sections.map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ol>
          </section>
        )}
        {book.sections.map((s) => (
          <section key={s.id} className="part">
            <h2>{s.title}</h2>
            {s.body
              .trim()
              .split(/\n{2,}/)
              .filter(Boolean)
              .map((p, i) => (
                <p key={i} style={{ whiteSpace: "pre-line" }}>
                  {p}
                </p>
              ))}
          </section>
        ))}
      </article>
    </>
  );
}
