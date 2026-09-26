/* Renders tools/gl-test.html (the phase contact sheet) over a local http
   server, because gl.js fetches the fp mesh and fetch() is blocked on
   the file: origin. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = '/Users/priticolours/Desktop/cmprssr-site';
const OUT = ROOT + '/.shots/gl-sheet.png';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.bin':'application/octet-stream', '.png':'image/png', '.css':'text/css' };

(async () => {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? '/tools/gl-test.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('no');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(8931, r));

  const b = await chromium.launch({ executablePath: EXE,
    args: ['--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1420, height: 1120 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto('http://localhost:8931/tools/gl-test.html');
  await p.waitForFunction(() => window.__ready === true, { timeout: 60000 }).catch(() => {});
  const ok = await p.evaluate(() => window.__ok);
  const err = await p.evaluate(() => window.__err);
  await p.screenshot({ path: OUT, fullPage: true });
  await b.close();
  srv.close();
  console.log('ok=' + ok + ' err=' + (err || 'none'));
  errs.slice(0, 5).forEach(e => console.log('console: ' + e));
})();
