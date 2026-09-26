/* Diagnostic for the empty wordmark frames. Builds the scene on a known
 * canvas and probes the framebuffer across the loop, so the point pass's
 * brightness and size can be set from measurement instead of from a
 * comment that turns out to be wrong by 5x.
 *
 * Needs the explicit executablePath + ANGLE args the other harnesses use;
 * Playwright's default headless shell is not installed here. */
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/priticolours/Desktop/cmprssr-site';
const EXE = process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/" +
  "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.bin':'application/octet-stream',
  '.svg':'image/svg+xml', '.png':'image/png' };

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
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));

  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.CMPRSSR3D, { timeout: 15000 }).catch(() => {});

  const report = await page.evaluate(async (count) => {
    const c = document.createElement('canvas');
    c.width = 700; c.height = 700;
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
    document.body.appendChild(c);
    const scene = await window.CMPRSSR3D.create(c, { count, preserve: true });
    const out = { sceneOk: !!(scene && scene.ok), count };
    if (!out.sceneOk) return out;
    out.points = scene.points.count;
    const gl = scene.gl;
    const px = new Uint8Array(700 * 700 * 4);

    for (const t of [0.3, 2.5, 4.6, 5.5, 6.5, 8.6]) {
      scene.draw(t);
      const err = gl.getError();
      gl.readPixels(0, 0, 700, 700, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let max = 0, lit = 0, sum = 0, clipped = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.max(px[i], px[i+1], px[i+2]);
        if (v > max) max = v;
        if (v > 12) lit++;
        if (v > 250) clipped++;
        sum += v;
      }
      const tot = px.length / 4;
      out['t' + t] = {
        glError: err, max,
        litPct: +(100 * lit / tot).toFixed(2),
        clipPct: +(100 * clipped / tot).toFixed(2),
        mean: +(sum / tot).toFixed(1),
      };
    }
    return out;
  }, Number(process.argv[2] || 150000));

  console.log(JSON.stringify(report, null, 2));
  await b.close();
  server.close();
});
