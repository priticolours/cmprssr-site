/* Screenshot the loop's key frames from the renderer's own pixels.
 *
 * Two traps, both of which produced confident wrong answers first:
 *
 *  1. el.screenshot() on the canvas composites the PAGE behind it. The
 *     scene clears to transparent (alpha: true, clear [0,0,0,0]) because
 *     the real hero canvas is transparent over the page background, so
 *     the shot comes back with the header, the hero copy and the buttons
 *     showing through — and a vision check then confidently "confirms"
 *     the nav wordmark instead of the particles. It reported the
 *     wordmark was legible when the canvas was not even in frame.
 *
 *  2. readPixels is bottom-up and putImageData is top-down, so the rows
 *     have to be flipped or the wordmark renders upside down.
 *
 * Fix for both: read the pixels, blit them onto an opaque 2D canvas, and
 * return that canvas as a data URL. Nothing from the page can leak in,
 * because nothing from the page is ever captured.
 */
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = '/Users/priticolours/.hermes/cache/scratch';
const EXE = process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/" +
  "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.bin':'application/octet-stream',
  '.svg':'image/svg+xml', '.png':'image/png' };
const S = 900;
const FRAMES = [[0.3,'open'], [1.6,'assemble'], [2.5,'fp'], [4.6,'cloud'],
                [5.5,'collapse'], [8.6,'hold']];

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
  const page = await b.newPage({ viewport: { width: 500, height: 500 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.CMPRSSR3D, { timeout: 15000 });

  await page.evaluate(async (S) => {
    const gl3d = document.createElement('canvas');
    gl3d.width = S; gl3d.height = S;
    document.body.appendChild(gl3d);
    const scene = await window.CMPRSSR3D.create(gl3d, { count: 150000, preserve: true });
    if (!scene || !scene.ok) throw new Error('scene did not build');

    const out = document.createElement('canvas');
    out.width = S; out.height = S;
    const cx = out.getContext('2d', { willReadFrequently: false });

    window.__render = (t) => {
      scene.draw(t);
      const gl = scene.gl;
      const w = gl3d.width, h = gl3d.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let max = 0, lit = 0, clip = 0, glErr = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.max(px[i], px[i+1], px[i+2]);
        if (v > max) max = v;
        if (v > 12) lit++;
        if (v > 250) clip++;
      }
      glErr = gl.getError();
      const n = px.length / 4;

      const row = w * 4;
      const flipped = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        flipped.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      }
      /* putImageData REPLACES pixels, alpha included — it does not
         composite over what is already there. The scene clears to alpha 0,
         so a naive putImageData emitted a fully transparent PNG, which
         reads as a black frame and looks exactly like a dead renderer.
         Force every pixel opaque: untouched ones take the page colour,
         drawn ones keep their RGB. */
      for (let i = 0; i < flipped.length; i += 4) {
        if (flipped[i + 3] === 0) {
          flipped[i] = 0x0b; flipped[i + 1] = 0x13; flipped[i + 2] = 0x1a;
        }
        flipped[i + 3] = 255;
      }
      cx.putImageData(new ImageData(flipped, w, h), 0, 0);
      return { max, litPct: 100 * lit / n, clipPct: 100 * clip / n, glErr, png: out.toDataURL('image/png') };
    };
  }, S);

  for (const [t, name] of FRAMES) {
    const r = await page.evaluate((t) => window.__render(t), t);
    const file = path.join(SHOTS, `f-${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(`t=${t}s  glErr=${r.glErr}  max=${String(r.max).padStart(3)}  ` +
      `lit=${r.litPct.toFixed(2).padStart(5)}%  clip=${r.clipPct.toFixed(3)}%  -> f-${name}.png`);
  }
  await b.close();
  server.close();
});
