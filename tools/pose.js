/* Renders a single large frame so the fp's facing can actually be seen.
   The 12-up contact sheet is too small to identify the lens mount.

   node tools/one.js [t] [outfile] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = '/Users/priticolours/Desktop/cmprssr-site';
const T = parseFloat(process.argv[2] || '2.4');
const OUT = ROOT + '/.shots/' + (process.argv[3] || 'one.png');
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.bin':'application/octet-stream' };

(async () => {
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? '/tools/pose.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      r.writeHead(404); return r.end('x');
    }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(8934, r));
  const b = await chromium.launch({ executablePath: EXE,
    args: ['--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 700 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto('http://localhost:8934/tools/pose.html');
  try {
    await p.waitForFunction('window.__ok===true', null, { timeout: 20000 });
  } catch (e) {
    const boot = await p.evaluate(() => window.__err || null);
    console.log('FAILED boot=' + boot);
    errs.slice(0, 4).forEach(x => console.log('  ' + x));
    await b.close(); srv.close();
    process.exit(1);
  }
  
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  /* let the compositor actually present the frames drawn by the page */
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.waitForTimeout(400);
  const figs = await p.$$('canvas');
  for (let i = 0; i < figs.length; i++) await figs[i].screenshot({ path: OUT.replace('.png', '-' + i + '.png') });
  console.log('wrote ' + figs.length + ' tiles');
  await b.close(); srv.close();
})();
