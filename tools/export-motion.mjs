/* ═══════════════════════════════════════════════════════════════════
   export-motion.mjs — renders the 3D piece to a looping video

   Captures frames from the real WebGL scene in headless Chromium
   (not a re-implementation), so the exported file is the same
   animation the page shows. Playwright drives the clock by hand and
   waits for one real frame to present after each draw, which is what
   makes the capture deterministic instead of racing rAF.

     node tools/export-motion.mjs [--fps 60] [--size 1080] [--out dist]
   ═══════════════════════════════════════════════════════════════════ */

import { chromium } from "/Users/priticolours/.hermes/cache/scratch/node_modules/playwright/index.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, readdir, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 ? process.argv[i + 1] : def;
};

const FPS = parseInt(arg("fps", "60"), 10);
const SIZE = parseInt(arg("size", "1080"), 10);
const OUT = path.resolve(ROOT, arg("out", "dist"));
const FRAMES = path.join(OUT, "frames");
/* Read the cycle from gl.js rather than hardcoding it: the renderer's
   timeline and the exported video must be the same loop, and a stale
   constant here silently produces a truncated file. */
const glSrc = fs.readFileSync(path.join(ROOT, "gl.js"), "utf8");
const CYCLE = parseFloat((glSrc.match(/var CYCLE = ([0-9.]+)/) || [])[1]);
if (!CYCLE) throw new Error("could not read CYCLE from gl.js");

const EXE = process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/" +
  "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#0b131a;overflow:hidden}
  #wrap{width:${SIZE}px;height:${SIZE}px;display:grid;place-items:center;
        background:radial-gradient(62% 62% at 50% 40%,rgba(95,123,142,.16),transparent 74%),#0b131a}
  canvas{width:${SIZE}px;height:${SIZE}px;display:block}
  #wm{position:absolute;bottom:${Math.round(SIZE * 0.052)}px;left:0;right:0;
      display:flex;align-items:center;justify-content:center;gap:${Math.round(SIZE * 0.014)}px;
      font-family:ui-monospace,Menlo,monospace;opacity:0}
  #wm b{font-size:${Math.round(SIZE * 0.031)}px;letter-spacing:-.03em;color:#eef2f5}
  #wm span{font-size:${Math.round(SIZE * 0.0115)}px;letter-spacing:.2em;color:#5f7b8e}
  #wm .gl{width:${Math.round(SIZE * 0.034)}px;height:${Math.round(SIZE * 0.034)}px}
</style></head>
<body>
<div id="wrap" style="position:relative">
  <canvas id="c"></canvas>
  <div id="wm"><span class="gl" data-mark="compact"></span><b>cmprssr</b><span>CINEMADNG → DNG</span></div>
</div>
<script src="/gl.js"></script>
<script src="/mark.js"></script>
<script>
  /* create() is async: the fp mesh is fetched before the scene exists. */
  window.__scene = null;
  window.CMPRSSR3D.create(document.getElementById('c'), { count: 150000 })
    .then(function (s) { window.__scene = s; window.__ok = !!(s && s.ok); })
    .catch(function (e) { window.__err = String(e && e.message || e); window.__ok = false; });

  const wm = document.getElementById('wm');
  window.__draw = function (t) {
    if (!window.__scene) return false;
    window.__scene.draw(t);
    /* the wordmark resolves with the logo, exactly as on the page */
    var k = t >= 6.4 ? 1 : (t >= 5.2 ? Math.max(0, ((t - 5.2) / 1.2 - 0.55) / 0.45) : 0);
    wm.style.opacity = k.toFixed(3);
    return !!window.__scene.ok;
  };
</script>
</body></html>`;

/* A real HTTP origin, because setContent on about:blank blocks
   file:// subresources and the whole capture silently times out. */
async function serve() {
  const http = await import("node:http");
  const fs = await import("node:fs/promises");
  const types = { ".js": "text/javascript", ".html": "text/html",
                  ".css": "text/css", ".png": "image/png" };
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    try {
      const body = await fs.readFile(path.join(ROOT, rel));
      res.writeHead(200, { "content-type": types[path.extname(rel)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

async function main() {
  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });

  const { server, port } = await serve();
  const origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    executablePath: EXE,
    args: ["--use-gl=angle", "--enable-unsafe-swiftshader",
           "--force-color-profile=srgb", "--disable-lcd-text"]
  });

  const ctx = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1
  });

  const errs = [];
  ctx.on("pageerror", e => errs.push(e.message));
  ctx.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  /* the capture page is written into ROOT and served like any other
     asset, so its /gl.js and /mark.js resolve over a real origin */
  const capturePath = path.join(ROOT, ".capture.html");
  await writeFile(capturePath, PAGE);

  await ctx.goto(origin + "/.capture.html", { waitUntil: "load" });
  /* the scene only exists once the fp mesh has been fetched and built,
     so the gate is __ok, not a sync call */
  await ctx.waitForFunction("window.__ok === true", null, { timeout: 60000 });
  const bootErr = await ctx.evaluate(() => window.__err || null);
  if (bootErr) throw new Error("capture page failed to build the scene: " + bootErr);

  const total = Math.round(CYCLE * FPS);
  console.log(`capturing ${total} frames @ ${FPS}fps, ${SIZE}px`);

  for (let f = 0; f < total; f++) {
    const t = (f / FPS) % CYCLE;
    await ctx.evaluate(tt => window.__draw(tt), t);
    /* one presented frame: the drawing buffer is only guaranteed to
       hold the draw after the compositor has taken it */
    await ctx.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
    await ctx.locator("#wrap").screenshot({
      path: path.join(FRAMES, String(f).padStart(5, "0") + ".png")
    });
    if (f % 60 === 0) process.stdout.write(`  ${f}/${total}\r`);
  }
  console.log(`  ${total}/${total}  done`);

  await browser.close();
  server.close();
  await rm(capturePath, { force: true });
  if (errs.length) console.error("page errors:\n" + errs.join("\n"));

  const files = (await readdir(FRAMES)).filter(f => f.endsWith(".png")).sort();
  const pattern = path.join(FRAMES, "%05d.png");

  const base = path.join(OUT, `cmprssr-loop-${SIZE}x${SIZE}`);

  console.log("encoding mp4 (h264)…");
  await run("ffmpeg", ["-y", "-framerate", String(FPS), "-i", pattern,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-crf", "18", "-preset", "slow", "-movflags", "+faststart",
    "-an", base + ".mp4"]);

  console.log("encoding webm (vp9)…");
  await run("ffmpeg", ["-y", "-framerate", String(FPS), "-i", pattern,
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-crf", "30",
    "-b:v", "0", "-row-mt", "1", "-an", base + ".webm"]);

  /* 6 key stills for decks and docs */
  /* one still per beat of the 9s loop */
  const picks = [0.3, 2.0, 3.0, 4.2, 5.0, 6.6];
  for (let i = 0; i < picks.length; i++) {
    await run("ffmpeg", ["-y", "-i", path.join(FRAMES,
      String(Math.round(picks[i] * FPS)).padStart(5, "0") + ".png"),
      path.join(OUT, `still-${String(i + 1).padStart(2, "0")}-t${picks[i]}.png`)]);
  }

  await writeFile(path.join(OUT, "README.txt"),
`cmprssr motion exports
======================
Generated by tools/export-motion.mjs

  cmprssr-loop-${SIZE}x${SIZE}.mp4    H.264 yuv420p, ${CYCLE}s, ${FPS}fps — loops seamlessly
  cmprssr-loop-${SIZE}x${SIZE}.webm   VP9, same timing
  still-01..06-*.png                key frames as stills

Timeline (seconds):
  0.0  logo holds
  1.0  camera builds from the exploded state
  2.8  assembled, turning
  2.8  explodes along the optical axis
  4.0  dissolves into a ${(26000/1000).toFixed(0)}k-point cloud
  5.2  the cloud condenses into the logo
  6.4  logo holds — matches t=0, so the loop is seamless
`);

  console.log("\nwrote:\n" + (await readdir(OUT)).map(f => "  " + f).join("\n"));
}

main().catch(e => { console.error(e); process.exit(1); });
