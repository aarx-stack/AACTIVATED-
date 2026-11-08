import { createHash } from "node:crypto";

/** The exact text of a publication. Approval is tied to this hash. */
export function contentHash(p: {
  title: string;
  subtitle: string | null;
  sections: { title: string; body: string }[];
}) {
  const canonical = JSON.stringify({
    title: p.title,
    subtitle: p.subtitle ?? "",
    sections: p.sections.map((s) => ({ title: s.title, body: s.body })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
