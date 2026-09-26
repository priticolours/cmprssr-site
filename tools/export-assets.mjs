/* ═══════════════════════════════════════════════════════════════════
   export-assets.mjs — writes the logo and icon files from the mark

   Everything is generated from mark.js so the standalone SVGs and the
   in-page mark are the same geometry. Raster sizes are produced by
   rendering the SVG in headless Chromium and screenshotting at the
   exact pixel size, so there is no resampling step to soften edges.

     node tools/export-assets.mjs
   ═══════════════════════════════════════════════════════════════════ */

import { chromium } from "/Users/priticolours/.hermes/cache/scratch/node_modules/playwright/index.mjs";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ASSETS = path.join(ROOT, "assets");
const SHOTS = path.join(ROOT, ".shots");

const EXE = process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/" +
  "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

/* The two rectangles are the logo: glass on the left, sensor on the
   right. This is also the endpoint the 3D piece condenses into, so the
   mark, the icon and the animation all share one silhouette. */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <rect x="58" y="44" width="42" height="152" rx="7" fill="#a9c1d1"/>
  <rect x="140" y="44" width="52" height="152" rx="7" fill="#f0662f"/>
  <rect x="153" y="26" width="26" height="188" rx="13" fill="#f0662f" opacity=".55"/>
</svg>`;

/* Icon: same two rectangles, inset on a navy field, weighted heavier
   so it survives 16px in a browser tab. */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="114" fill="#0b131a"/>
  <rect x="142" y="164" width="76" height="184" rx="14" fill="#a9c1d1"/>
  <rect x="294" y="164" width="92" height="184" rx="14" fill="#f0662f"/>
</svg>`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <rect x="46" y="36" width="58" height="168" rx="11" fill="#a9c1d1"/>
  <rect x="136" y="36" width="70" height="168" rx="11" fill="#f0662f"/>
</svg>`;

/* Lockup: the mark plus the wordmark.
   The wordmark is converted to real OUTLINES by pango-view at export
   time. An earlier version hand-wrote the letter paths and rendered
   "cmprssr" as "ᴜ UN:LU"; a second version used <text>, which looks
   different on every machine that lacks the same font. Outlines are
   the only version that is identical everywhere. */
async function wordmarkPaths() {
  const tmp = path.join(SHOTS, ".wm.svg");
  await run("pango-view", [
    "--no-display", "--font=SF Mono Bold 74", "--text=cmprssr",
    "-o", tmp
  ]);
  const svg = await readFile(tmp, "utf8");
  await rm(tmp, { force: true });

  /* pango emits 5 unique glyph outlines in <defs> and places them with
     <use xlink:href="#glyph-N" x=".." y="..">. Extracting only the
     <path> tags drops the defs and leaves nothing to draw — so each
     <use> is replaced by a translated copy of the path it references.
     That inlines 7 references into 7 standalone outlines, which is
     what makes the wordmark render without any font dependency. */
  const defs = svg.match(/<defs>([\s\S]*?)<\/defs>/);
  if (!defs) throw new Error("pango output had no <defs>");
  const glyphs = {};
  for (const m of defs[1].matchAll(/<g id="(glyph-[^"]+)"[^>]*>([\s\S]*?)<\/g>\s*(?=<g id=|$)/g)) {
    glyphs[m[1]] = [...m[2].matchAll(/<path[^>]*\/>/g)].map(p => p[0]).join("");
  }

  const out = [];
  for (const u of svg.matchAll(/<use xlink:href="#([^"]+)" x="([-\d.]+)" y="([-\d.]+)"\s*\/>/g)) {
    const [, id, x, y] = u;
    const d = glyphs[id];
    if (!d) continue;
    out.push(`<g transform="translate(${x},${y})">${d}</g>`);
  }
  if (!out.length) throw new Error("no <use> elements resolved");

  /* pango's glyph coords are y-up with a baseline offset; the
     translate puts the baseline at 0 so the group can be placed freely */
  return `<g fill="#eef2f5">${out.join("")}</g>`;
}

const RASTER = [
  { file: "favicon-16.png", svg: FAVICON, size: 16 },
  { file: "favicon-32.png", svg: FAVICON, size: 32 },
  { file: "favicon-48.png", svg: FAVICON, size: 48 },
  { file: "apple-touch-icon.png", svg: ICON, size: 180 },
  { file: "icon-512.png", svg: ICON, size: 512 },
  { file: "icon-1024.png", svg: ICON, size: 1024 },
  { file: "mark-1024.png", svg: LOGO, size: 1024, flat: true },
  { file: "mark-512.png", svg: LOGO, size: 512, flat: true },
];

async function main() {
  await mkdir(ASSETS, { recursive: true });
  await mkdir(SHOTS, { recursive: true });

  /* ── SVG files ─────────────────────────────────────────────── */
  const wm = await wordmarkPaths();
  const svgs = {
    "mark.svg": LOGO,
    "mark-compact.svg": FAVICON,
    "favicon.svg": FAVICON,
    "icon.svg": ICON,
    "lockup-horizontal.svg":
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" role="img" aria-label="cmprssr">` +
      `<g transform="translate(4,-16) scale(0.62)">` +
      LOGO.replace(/<\/?svg[^>]*>/g, "").replace(/viewBox="[^"]*"/, "") +
      `</g>` +
      `<g transform="translate(134,0) scale(0.62)">${wm}</g>` +
      `</svg>`,
  };
  for (const [name, body] of Object.entries(svgs)) {
    await writeFile(path.join(ASSETS, name), body);
    console.log("  svg  " + name);
  }

  /* ── rasters ─────────────────────────────────────────────────
     Each SVG is sized by setting width/height on the ROOT <svg>
     only. An earlier version regex-stripped every width/height in
     the document, which also removed the icon's background rect and
     produced a blank PNG — so the root tag is edited precisely. */
  const browser = await chromium.launch({ executablePath: EXE,
    args: ["--force-color-profile=srgb", "--disable-lcd-text"] });

  for (const job of RASTER) {
    const ctx = await browser.newPage({
      viewport: { width: job.size, height: job.size },
      deviceScaleFactor: 1
    });
    const sized = job.svg.replace(
      /^<svg([^>]*)>/,
      `<svg$1 width="${job.size}" height="${job.size}">`
    );
    const bg = job.flat ? "#0b131a" : "transparent";
    await ctx.setContent(
      `<body style="margin:0;background:${bg};width:${job.size}px;height:${job.size}px">
         ${sized}
       </body>`,
      { waitUntil: "load" }
    );
    await ctx.waitForTimeout(140);
    await ctx.screenshot({
      path: path.join(ASSETS, job.file),
      omitBackground: !job.flat
    });
    await ctx.close();
    console.log(`  png  ${job.file}  ${job.size}px`);
  }

  /* ── social card ─────────────────────────────────────────────
     1200×630 OG image, generated from the same mark so the share
     preview is the brand rather than a screenshot of the page. */
  const inner = LOGO.replace(/<\/?svg[^>]*>/g, "").replace(/viewBox="[^"]*"/, "");
  const card = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:630px;background:#0b131a;overflow:hidden;position:relative;
       font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
       display:flex;flex-direction:column;justify-content:center;gap:74px;padding:64px 72px}
  .glow{position:absolute;inset:-30% -10% auto;height:110%;
        background:radial-gradient(52% 56% at 30% 46%,rgba(95,123,142,.24),transparent 72%)}
  .row{position:relative;display:flex;align-items:center;gap:30px}
  h1{font-size:62px;line-height:1.04;letter-spacing:-2.4px;color:#eef2f5;font-weight:700}
  h1 span{color:#6f8494}
  p{font-size:23px;color:#a9bcc9;margin-top:20px;line-height:1.5;max-width:32ch}
  .foot{position:relative;display:flex;align-items:center}
  svg{overflow:visible}
</style></head><body>
  <div class="glow"></div>
  <div class="row">
    <svg width="132" height="132" viewBox="0 0 240 240">${inner}</svg>
    <div>
      <h1>Shrink the raw.<br><span>Keep the grade.</span></h1>
      <p>CinemaDNG &amp; R3D batch compression for macOS.</p>
    </div>
  </div>
  <div class="foot">
    <svg width="440" height="94" viewBox="0 0 360 120">
      <g transform="translate(4,-16) scale(0.62)">${inner}</g>
      <g transform="translate(134,0) scale(0.62)">${wm}</g>
    </svg>
  </div>
</body></html>`;

  const cctx = await browser.newPage({
    viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1
  });
  await cctx.setContent(card, { waitUntil: "load" });
  await cctx.waitForTimeout(180);
  await cctx.screenshot({ path: path.join(ASSETS, "social-card.png") });
  await cctx.close();
  console.log("  png  social-card.png  1200x630");

  await browser.close();
  console.log("\nassets written to assets/");
}
main().catch(e => { console.error(e); process.exit(1); });
