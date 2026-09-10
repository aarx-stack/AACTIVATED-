/**
 * Bundle the built demo into one self-contained HTML fragment suitable for
 * hosting surfaces that wrap content in their own document skeleton: inlines
 * the Vite JS/CSS, keeps only <title> + font links + #root + module script.
 * Run `vite build` first (or use `npm run build:singlefile`).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const html = readFileSync(resolve(dist, "index.html"), "utf8");

const cssFile = html.match(/href="\/(assets\/[^"]+\.css)"/)?.[1];
const jsFile = html.match(/src="\/(assets\/[^"]+\.js)"/)?.[1];
if (!cssFile || !jsFile) throw new Error("could not find built assets in dist/index.html");

const css = readFileSync(resolve(dist, cssFile), "utf8");
const js = readFileSync(resolve(dist, jsFile), "utf8");

const fontLinks = [...html.matchAll(/<link[^>]+(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g)]
  .map((m) => m[0])
  .join("\n");

const out = `<title>AACTIVATED RX Leaderboard</title>
${fontLinks}
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

mkdirSync(resolve(process.cwd(), "dist-artifact"), { recursive: true });
const outPath = resolve(process.cwd(), "dist-artifact", "aactivated-leaderboard-demo.html");
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${(out.length / 1024).toFixed(0)} KB)`);
