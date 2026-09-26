
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto('file:///Users/priticolours/Desktop/cmprssr-site/tools/gl-test.html');
  await p.waitForFunction(() => window.__ready === true, { timeout: 15000 }).catch(()=>{});
  const ok = await p.evaluate(() => window.__ok);
  const info = await p.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'no webgl2';
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'renderer hidden';
  });
  console.log('scenes ok:', ok, '| gl:', info);
  await p.screenshot({ path: '/Users/priticolours/Desktop/cmprssr-site/.shots/gl-sheet.png', fullPage: true });
  console.log(errs.length ? 'ERRORS:\n'+errs.join('\n') : 'no errors');
  await b.close();
})();
