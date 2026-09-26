const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = '/Users/priticolours/Desktop/cmprssr-site';
const OUT = ROOT + '/.shots';

/* gl.js fetches the fp mesh, and fetch() is blocked on the file: origin,
   so the page has to be served over http to get its 3D. */
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
                '.bin':'application/octet-stream','.png':'image/png','.css':'text/css','.svg':'image/svg+xml' };

(async () => {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? '/index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('no');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(8933, r));
  const SITE = 'http://localhost:8933/index.html';

  const b = await chromium.launch({ executablePath: EXE,
    args: ['--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const errs = [];

  for (const [name, w, h] of [['desktop', 1440, 900], ['tablet', 1024, 800], ['mobile', 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    p.on('console', m => { if (m.type() === 'error') errs.push(`[${name}] ${m.text()}`); });
    p.on('pageerror', e => errs.push(`[${name}] PAGEERROR ${e.message}`));
    await p.goto(SITE, { waitUntil: 'load' });
    await p.waitForTimeout(900);
    // reveal everything so the full-page shot isn't blank below the fold
    await p.evaluate(() => document.querySelectorAll('.rise').forEach(e => e.classList.add('in')));
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${name}-hero.png` });
    await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
    const overflow = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${name} ${w}x${h}  h-overflow=${overflow}px`);
    await p.close();
  }

  // hero animation: three moments
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(SITE, { waitUntil: 'load' });
  for (const [t, label] of [[300, 'a-exploded'], [1700, 'b-pack'], [3100, 'c-hold']]) {
    await p.waitForTimeout(t === 300 ? 300 : 1400);
    await p.locator('.hero-stage').screenshot({ path: `${OUT}/motion-${label}.png` });
  }
  await p.close();

  // reduced motion
  const rp = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await rp.goto(SITE, { waitUntil: 'load' });
  await rp.waitForTimeout(700);
  await rp.locator('.hero-stage').screenshot({ path: `${OUT}/motion-reduced.png` });
  await rp.close();

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await b.close(); srv.close();
})();
