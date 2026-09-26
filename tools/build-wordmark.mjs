/* ═══════════════════════════════════════════════════════════════════
   build-wordmark.mjs — turns the "cmprssr" wordmark into three things
   from ONE source of truth:

     assets/wordmark.svg        the vector, as pango outlines
     assets/wordmark-mask.png   the same shape rasterised, as a mask
     assets/wordmark-target.bin xyz sample points, for the cloud

   Why a build step at all: the page's nav wordmark is system-font text
   today, so pointing the particle cloud at a *different* glyph outline
   would make the page's claim ("contracts into the logo at the top")
   approximately true rather than exactly true. Everything below is
   generated once, and the nav, the icon and the 3D all read the same
   geometry.

   Sampling is rejection sampling on the mask's alpha channel, which
   gives a uniform distribution over the filled letterforms with no
   area table to build or keep in sync.

     node tools/build-wordmark.mjs
   ═══════════════════════════════════════════════════════════════════ */

import { chromium } from "/Users/priticolours/.hermes/cache/scratch/node_modules/playwright/index.mjs";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ASSETS = path.join(ROOT, "assets");

const EXE = process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/" +
  "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

/* Samples baked into the target blob. The cloud samples the fp from
   these points at load time, so this is the ceiling — 150k. */
const SAMPLES = 150000;

/* The wordmark's width in scene units, matching how the fp is
   normalised (longest axis -> 1.0). 1.3 fills the hero frame without
   the letterforms becoming so thin the points cannot hold them. */
const WIDTH = 1.3;

/* Raster resolution for sampling. 2048 wide is ~1.6k samples across the
   glyphs, which is finer than the 150k points can resolve, so the
   sampled cloud is limited by point count and never by the mask. */
const RASTER = 2048;

/* DejaVu Sans Mono Bold, not SF Mono. SF Mono is Apple's font and its
   licence does not permit redistributing outlines; baking them into a
   public repo's assets would ship a font nobody licensed. DejaVu is
   SIL Open Font License 1.1, which explicitly allows embedding and
   derivative works. It is also a close enough match to the site's
   system monospace stack that the header does not visibly shift. */
const FONT = "DejaVu Sans Mono Bold";
const SIZE = 74;

async function outlines() {
  const tmp = path.join(ASSETS, ".wm-raw.svg");
  await run("pango-view", [
    "--no-display", `--font=${FONT} ${SIZE}`, "--text=cmprssr", "-o", tmp
  ]);
  const svg = await readFile(tmp, "utf8");
  await rm(tmp, { force: true });

  /* pango emits unique glyph outlines in <defs> and places them with
     <use xlink:href="#glyph-N" x=".." y="..">. Copying only the <path>
     tags drops the defs and leaves nothing to draw, so each reference
     is inlined as a translated copy of the outline it points at. */
  const defs = svg.match(/<defs>([\s\S]*?)<\/defs>/);
  if (!defs) throw new Error("pango output had no <defs>");
  const glyphs = {};
  for (const m of defs[1].matchAll(/<g id="(glyph-[^"]+)"[^>]*>([\s\S]*?)<\/g>\s*(?=<g id=|$)/g)) {
    glyphs[m[1]] = [...m[2].matchAll(/<path[^>]*\/>/g)].map(p => p[0]).join("");
  }

  const out = [];
  for (const u of svg.matchAll(/<use xlink:href="#([^"]+)" x="([-\d.]+)" y="([-\d.]+)"\s*\/>/g)) {
    const [, id, x, y] = u;
    if (glyphs[id]) out.push(`<g transform="translate(${x},${y})">${glyphs[id]}</g>`);
  }
  if (out.length !== 7) throw new Error(`expected 7 glyphs, got ${out.length}`);

  /* pango's own viewBox, so the normalised SVG is dimensionally
     identical to what it sampled — no guess at the aspect ratio. */
  const vb = (svg.match(/viewBox="([\d.\- ]+)"/) || [])[1];
  if (!vb) throw new Error("pango output had no viewBox");
  return { body: out.join(""), viewBox: vb };
}

async function main() {
  await mkdir(ASSETS, { recursive: true });
  const { body, viewBox } = await outlines();
  const [, , vw, vh] = viewBox.split(/\s+/).map(Number);

  /* ── the vector ────────────────────────────────────────────── */
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
    `role="img" aria-label="cmprssr">` +
    /* currentColor so the nav and the 3D agree on ink */
    `<g fill="currentColor">${body}</g></svg>`;
  await writeFile(path.join(ASSETS, "wordmark.svg"), svg);
  console.log(`  svg   wordmark.svg  viewBox="${viewBox}"  7 glyphs`);

  /* ── the mask ──────────────────────────────────────────────── */
  const browser = await chromium.launch({ executablePath: EXE,
    args: ["--force-color-profile=srgb", "--disable-lcd-text"] });
  const H = Math.round(RASTER * (vh / vw));
  const page = await browser.newPage({
    viewport: { width: RASTER, height: H },
    deviceScaleFactor: 1
  });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}
     svg{display:block;width:${RASTER}px;height:${H}px}</style>` + svg
  );
  const png = await page.screenshot({ omitBackground: true });
  await writeFile(path.join(ASSETS, "wordmark-mask.png"), png);

  /* ── the sample points ─────────────────────────────────────── */
  /* Read the mask back through a canvas: alpha > 128 means inside a
     letterform. Rejection sampling on that gives uniform density
     across the whole wordmark, which is what keeps thin strokes like
     the "r" from vanishing. */
  const b64 = png.toString("base64");
  const pts = await page.evaluate(async ({ b64, W, H, N, worldW }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d");
    cx.drawImage(img, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;

    // total opaque pixels, so the fill fraction is known up front
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) opaque++;
    if (!opaque) return null;

    // deterministic PRNG: the cloud must be identical on every load,
    // or the video and the page would show different things
    let s = 0x9e3779b9;
    const rnd = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };

    const out = new Float32Array(N * 3);
    const scale = worldW / W;
    let n = 0, guard = 0;
    while (n < N && guard < N * 400) {
      guard++;
      const px = (rnd() * W) | 0, py = (rnd() * H) | 0;
      if (d[(py * W + px) * 4 + 3] <= 128) continue;
      // raster is y-down; scene is y-up, centred on the wordmark
      out[n * 3]     = (px + 0.5) * scale - worldW / 2;
      out[n * 3 + 1] = worldW / 2 - (py + 0.5) * scale;
      out[n * 3 + 2] = 0;
      n++;
    }
    /* Hand the samples back as base64 rather than a JSON array: 450k
       floats serialise to megabytes of text, and the round trip through
       JSON also loses float32 precision. */
    const bytes = new Uint8Array(out.buffer, 0, n * 3 * 4);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return { n, aspect: H / W, b64: btoa(bin) };
  }, { b64, W: RASTER, H, N: SAMPLES, worldW: WIDTH });

  await page.close();
  await browser.close();
  if (!pts) throw new Error("mask was empty — nothing to sample");
  if (pts.n < SAMPLES * 0.9) {
    throw new Error(`only sampled ${pts.n}/${SAMPLES} — raise RASTER`);
  }

  const blob = Buffer.from(pts.b64, "base64");
  await writeFile(path.join(ASSETS, "wordmark-target.bin"), blob);
  if (blob.length !== pts.n * 3 * 4) {
    throw new Error(`blob is ${blob.length}B, expected ${pts.n * 3 * 4}B`);
  }
  const meta = {
    count: pts.n,
    width: WIDTH,
    height: WIDTH * pts.aspect,
    raster: [RASTER, Math.round(RASTER * pts.aspect)],
    /* Derived from FONT, not a literal — a hardcoded string drifts the
       moment the font changes, and then the file lies about its own
       provenance, which is worse than having no field at all. */
    source: `pango-view ${FONT} ${SIZE}, text=cmprssr`,
    license: "DejaVu Sans Mono is SIL OFL 1.1. SF Mono is NOT "
      + "redistributable as outlines and must not be used here.",
    note: "xyz float32, y-up, centred, z=0. Scene width = width."
  };
  await writeFile(path.join(ASSETS, "wordmark-target.json"),
    JSON.stringify(meta, null, 2));
  console.log(`  png   wordmark-mask.png  ${RASTER}x${Math.round(RASTER * pts.aspect)}`);
  console.log(`  bin   wordmark-target.bin  ${pts.n} points  ` +
              `${(fs.statSync(path.join(ASSETS, "wordmark-target.bin")).size / 1048576).toFixed(2)}MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
