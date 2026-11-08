/**
 * EPUB 3 export with Node's built-in zlib only (no extra dependencies).
 * The archive is a plain ZIP: "mimetype" first and uncompressed, as the EPUB spec requires;
 * everything else is deflated.
 */
import { crc32, deflateRawSync } from "node:zlib";
import type { ExportModel } from "./service";

interface Entry {
  name: string;
  data: Buffer;
  store?: boolean;
}

/** A minimal ZIP writer (local headers, central directory, end record). */
export function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // Fixed DOS date/time: exports of the same text are byte-identical.
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const body = e.store ? e.data : deflateRawSync(e.data);
    const crc = crc32(e.data);
    const method = e.store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Plain text (blank line between paragraphs) to XHTML paragraphs. */
export function paragraphs(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeXml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

const STYLE = `body{font-family:Georgia,serif;line-height:1.55;margin:0 5%}
h1{font-size:1.6em;margin:1.5em 0 .8em}h2{font-size:1.3em}
p{margin:0 0 .9em}.draft{border:1px solid #c00;color:#c00;padding:.4em .6em;font-family:sans-serif;font-size:.85em}
.cover{text-align:center;margin-top:30%}.cover p{color:#555}`;

export function buildEpub(book: ExportModel, id: string): Buffer {
  const parts = book.sections.map((s, i) => ({ ...s, file: `part-${i + 1}.xhtml`, n: i + 1 }));
  const draftNote = book.final
    ? ""
    : `<p class="draft">DRAFT: not approved for publishing. Internal review copy.</p>`;
  const page = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="UTF-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>${body}</body></html>`;

  const cover = page(
    book.title,
    `<div class="cover"><h1>${escapeXml(book.title)}</h1>${book.subtitle ? `<p>${escapeXml(book.subtitle)}</p>` : ""}<p>${escapeXml(book.author)}</p>${draftNote}</div>`,
  );
  const nav = page(
    "Contents",
    `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${parts
      .map((p) => `<li><a href="${p.file}">${escapeXml(p.title)}</a></li>`)
      .join("")}</ol></nav>`,
  );
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:aactivated:${escapeXml(id)}</dc:identifier>
<dc:title>${escapeXml(book.title)}</dc:title>
<dc:creator>${escapeXml(book.author)}</dc:creator>
<dc:language>en</dc:language>
<meta property="dcterms:modified">${book.updatedAt.toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${parts.map((p) => `<item id="p${p.n}" href="${p.file}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine>
<itemref idref="cover"/>
<itemref idref="nav"/>
${parts.map((p) => `<itemref idref="p${p.n}"/>`).join("\n")}
</spine>
</package>`;
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

  return zip([
    { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
    { name: "META-INF/container.xml", data: Buffer.from(container) },
    { name: "OEBPS/content.opf", data: Buffer.from(opf) },
    { name: "OEBPS/style.css", data: Buffer.from(STYLE) },
    { name: "OEBPS/cover.xhtml", data: Buffer.from(cover) },
    { name: "OEBPS/nav.xhtml", data: Buffer.from(nav) },
    ...parts.map((p) => ({
      name: `OEBPS/${p.file}`,
      data: Buffer.from(
        page(p.title, `<h1>${escapeXml(p.title)}</h1>\n${draftNote}${paragraphs(p.body)}`),
      ),
    })),
  ]);
}

/** A safe download file name. */
export function fileNameFor(title: string, ext: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "publication"}.${ext}`;
}
