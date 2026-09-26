/* ═══════════════════════════════════════════════════════════════════
   tune-points.js — pick the cloud's point size and alpha by measurement

   The 15k cloud needed uSize 0.026 and alpha 0.26. Naively carrying those
   to 150k produced a blown-out white disc: the blend is additive, so a
   point's contribution accumulates with every neighbour that overlaps it,
   and at 10x the count the overlap per pixel went up ~10x too. A comment
   claiming 0.019 "lands around 1.6px" was wrong by 5x — the real figure
   was 8-11px. That is the kind of number that has to be measured.

   So: sweep the pair, and score each candidate on the framebuffer rather
   than on how a screenshot looks. Three things have to hold at once —

     clipPct  the blown-out fraction. Must be ~0; this is the defect the
              user called out by name.
     litPct   how much of the frame the wordmark occupies. If this falls
              off, the points got too small to read as letters.
     max      peak brightness. Should reach near-white WITHOUT a tail of
              clipped pixels, i.e. bright core, no flat plateau.

   Swept at the final hold (t=8.6), which is the frame the piece is judged
   on and the densest because every point has converged onto the wordmark.

     node tools/tune-points.js
   ═══════════════════════════════════════════════════════════════════ */

const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXE = process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/" +
  "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.bin':'application/octet-stream',
  '.svg':'image/svg+xml', '.png':'image/png' };

/* Hold frame: the point cloud fully settled on the wordmark. */
const T_HOLD = 8.6;
/* Mid-cloud, where points are spread over a volume and overlap least —
   the opposite end of the density range. */
const T_CLOUD = 4.6;
const SIZE = 700;

const SIZES   = [0.0040, 0.0050, 0.0062, 0.0075, 0.0090, 0.0120];
const ALPHAS  = [0.020, 0.035, 0.055, 0.080, 0.120];

function stats(px) {
  let max = 0, lit = 0, clip = 0, sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(px[i], px[i+1], px[i+2]);
    if (v > max) max = v;
    if (v > 12) lit++;
    if (v > 250) clip++;
    sum += v;
  }
  const n = px.length / 4;
  return { max, litPct: 100*lit/n, clipPct: 100*clip/n, mean: sum/n };
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

server.listen(0, async () => {
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE,
    args: ['--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await b.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.CMPRSSR3D, { timeout: 15000 });

  const rows = await page.evaluate(async ({sizes, alphas, tHold, tCloud, S}) => {
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
    document.body.appendChild(c);
    const scene = await window.CMPRSSR3D.create(c, { count: 150000, preserve: true });
    if (!scene.ok) return { error: 'scene did not build' };
    const gl = scene.gl;
    const px = new Uint8Array(S * S * 4);

    function measure(t) {
      scene.draw(t);
      const err = gl.getError();
      gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let max = 0, lit = 0, clip = 0, sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.max(px[i], px[i+1], px[i+2]);
        if (v > max) max = v;
        if (v > 12) lit++;
        if (v > 250) clip++;
        sum += v;
      }
      const n = px.length / 4;
      return { glError: err, max, litPct: 100*lit/n, clipPct: 100*clip/n, mean: sum/n };
    }

    const out = [];
    for (const size of sizes) {
      for (const alpha of alphas) {
        scene.size = size;
        scene.alphaScale = alpha;
        const hold = measure(tHold);
        const cloud = measure(tCloud);
        out.push({ size, alpha, hold, cloud });
      }
    }
    return out;
  }, { sizes: SIZES, alphas: ALPHAS, tHold: T_HOLD, tCloud: T_CLOUD, S: SIZE });

  if (rows.error) { console.log('FAILED:', rows.error); await b.close(); server.close(); return; }

  console.log(`count=150000  hold=t=${T_HOLD}  cloud=t=${T_CLOUD}  canvas=${SIZE}px\n`);
  console.log('size     alpha    hold: max lit%  clip%   |  cloud: max lit%  clip%');
  console.log('-'.repeat(72));
  for (const r of rows) {
    console.log(
      `${r.size.toFixed(4)}  ${r.alpha.toFixed(3)}    ` +
      `${String(r.hold.max).padStart(3)} ${r.hold.litPct.toFixed(1).padStart(5)} ${r.hold.clipPct.toFixed(2).padStart(6)}   |  ` +
      `${String(r.cloud.max).padStart(3)} ${r.cloud.litPct.toFixed(1).padStart(5)} ${r.cloud.clipPct.toFixed(2).padStart(6)}`);
  }

  /* Pick: no clipping anywhere, the brightest peak we can get without it,
     and enough lit area at the hold that the letters still read. */
  const clean = rows.filter(r => r.hold.clipPct < 0.05 && r.cloud.clipPct < 0.05);
  if (!clean.length) {
    console.log('\nno candidate clips under 0.05% — alpha needs to go lower');
  } else {
    const best = clean
      .filter(r => r.hold.litPct >= 1.5)
      .sort((x, y) => (y.hold.max - x.hold.max) || (y.hold.litPct - x.hold.litPct))[0];
    console.log(`\nbest: size=${best.size} alpha=${best.alpha}` +
      `  hold max=${best.hold.max} lit=${best.hold.litPct.toFixed(1)}% clip=${best.hold.clipPct.toFixed(3)}%` +
      `  cloud lit=${best.cloud.litPct.toFixed(1)}%`);
  }

  await b.close();
  server.close();
});
