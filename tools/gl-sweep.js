
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 400 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file:///Users/priticolours/Desktop/cmprssr-site/tools/gl-sweep.html');
  await p.waitForFunction(() => window.__ready, { timeout: 20000 }).catch(()=>console.log('timeout'));
  console.log((await p.$$eval('figcaption', e=>e.map(x=>x.textContent))).join('\n'));
  await p.screenshot({ path: '/Users/priticolours/Desktop/cmprssr-site/.shots/gl-sweep.png', fullPage: true });
  await b.close();
})();
