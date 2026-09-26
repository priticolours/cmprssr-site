/* Finds the specific elements wider than the viewport, so a
   h-overflow failure names its own cause instead of a pixel count.
   Run: node tools/whowide.js [width] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = '/Users/priticolours/Desktop/cmprssr-site';
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
                '.bin':'application/octet-stream','.png':'image/png','.css':'text/css','.svg':'image/svg+xml' };

const W = parseInt(process.argv[2] || '390', 10);

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
  await new Promise(r => srv.listen(8932, r));
  const b = await chromium.launch({ executablePath: EXE,
    args: ['--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await p.goto('http://localhost:8932/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const bad = await p.evaluate((vw) => {
    const out = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && el.className.baseVal !== undefined
                ? el.className.baseVal : String(el.className || '')).slice(0, 60),
          left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width)
        });
      }
    });
    return out.slice(0, 25);
  }, W);
  console.log('viewport ' + W + ' — ' + bad.length + ' overflowing:');
  bad.forEach(o => console.log(`  ${o.tag}.${o.cls}  left=${o.left} right=${o.right} w=${o.w}`));
  await b.close(); srv.close();
})();
