/** Renders stored document text: paragraphs, and lines starting with "-" as bullet lists. */
export function DocumentBody({ text }: { text: string }) {
  const blocks: ({ type: "p"; text: string } | { type: "ul"; items: string[] })[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.type === "ul") last.items.push(bullet[1]!);
      else blocks.push({ type: "ul", items: [bullet[1]!] });
    } else {
      blocks.push({ type: "p", text: line });
    }
  }
  return (
    <div className="flex max-w-[70ch] flex-col gap-3 text-[15px] leading-relaxed">
      {blocks.map((b, i) =>
        b.type === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5 marker:text-cyan">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
