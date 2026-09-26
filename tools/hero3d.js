
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const SITE='file:///Users/priticolours/Desktop/cmprssr-site/index.html';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args:['--use-gl=angle','--enable-unsafe-swiftshader'] });
  const errs=[];
  const p = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
  p.on('console', m => { if(m.type()==='error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR '+e.message));
  await p.goto(SITE, { waitUntil:'load' });
  await p.waitForTimeout(1200);
  // sample the piece at four moments of its 7s cycle
  const marks = [[500,'1-logo'],[2600,'2-assembled'],[1800,'3-cloud'],[1500,'4-condense']];
  for (const [wait,label] of marks){
    await p.waitForTimeout(wait);
    await p.locator('.gl-frame').screenshot({ path:`/Users/priticolours/Desktop/cmprssr-site/.shots/hero3d-${label}.png` });
  }
  const readout = await p.$eval('.readout', e => e.innerText.replace(/\n/g,' | '));
  console.log('readout:', readout);
  console.log(errs.length ? 'ERRORS:\n'+errs.join('\n') : 'no errors');
  await b.close();
})();
