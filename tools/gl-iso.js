
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 460 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file:///Users/priticolours/Desktop/cmprssr-site/tools/gl-isolate.html');
  await p.waitForFunction(() => window.__ready, { timeout: 15000 }).catch(()=>{});
  const caps = await p.$$eval('figcaption', els => els.map(e => e.textContent));
  console.log(caps.join('\n'));
  await p.screenshot({ path: '/Users/priticolours/Desktop/cmprssr-site/.shots/gl-isolate.png', fullPage: true });
  await b.close();
})();
