const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = '/Users/priticolours/Desktop/cmprssr-site';
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const TYPES = {'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4',
  '.webm':'video/webm','.html':'text/html','.js':'text/javascript','.css':'text/css','.txt':'text/plain'};

const srv = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'') || 'index.html';
  try {
    const b = fs.readFileSync(path.join(ROOT, rel));
    res.writeHead(200,{'content-type': TYPES[path.extname(rel)]||'application/octet-stream'});
    res.end(b);
  } catch(e){ res.writeHead(404); res.end('nf'); }
});

(async()=>{
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}/index.html`;
  const b = await chromium.launch({ executablePath: EXE, args:['--use-gl=angle','--enable-unsafe-swiftshader'] });
  let fails = 0;
  const check = (name, ok, detail='') => {
    console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?'  '+detail:''}`);
    if(!ok) fails++;
  };

  // 1. every local asset resolves. The GitHub releases API legitimately
  //    404s while the app is unreleased — that is the signal the button
  //    falls back to the releases page, so it is not a failure.
  {
    const p = await b.newPage();
    const missing = [];
    p.on('response', r => {
      if (r.status() >= 400 && !r.url().includes('api.github.com')) {
        missing.push(r.url() + ' ' + r.status());
      }
    });
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    check('all local assets resolve', missing.length === 0, missing.join(', '));
    await p.close();
  }

  // 2. no console/page errors, ignoring the expected API 404
  {
    const p = await b.newPage();
    const errs = [];
    p.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && !t.includes('404')) errs.push(t);
    });
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(2000);
    check('no console or page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await p.close();
  }

  // 3. no horizontal overflow at any width
  for (const w of [1440,1024,768,390,320]) {
    const p = await b.newPage({ viewport:{width:w,height:900} });
    await p.goto(base,{waitUntil:'load'});
    await p.waitForTimeout(900);
    const o = await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    check(`no h-overflow @ ${w}px`, o===0, o?`${o}px`:'');
    await p.close();
  }

  // 4. WebGL canvas actually painted something.
  //    Uses screenshot pixels, not readPixels: by the time a frame has
  //    composited, the drawing buffer is cleared, and a second
  //    getContext() call does not return the handle the scene drew with.
  {
    const p = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
    await p.goto(base,{waitUntil:'load'});
    await p.waitForTimeout(2500);
    const shot = await p.locator('.gl-frame').screenshot();
    /* decode via the browser: count pixels that are neither the panel
       background nor fully transparent */
    const lit = await p.evaluate(async b64 => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        /* the panel bg is ~#131d26 / #0d151c; count anything brighter */
        if (d[i] > 70 || d[i+1] > 80 || d[i+2] > 90) n++;
      }
      return { lit: n, w: c.width, h: c.height };
    }, shot.toString('base64'));
    check('webgl canvas is painting', lit.lit > 3000, JSON.stringify(lit));
    await p.close();
  }

  // 5. reduced motion holds a static frame and does not animate
  {
    const p = await b.newPage({ viewport:{width:1440,height:900}, reducedMotion:'reduce' });
    await p.goto(base,{waitUntil:'load'});
    await p.waitForTimeout(600);
    const a = await p.locator('.gl-frame').screenshot();
    await p.waitForTimeout(1400);
    const c = await p.locator('.gl-frame').screenshot();
    check('reduced-motion is static', Buffer.compare(a,c)===0, `${a.length} vs ${c.length} bytes`);
    const ro = await p.$eval('.readout', e=>e.innerText.replace(/\n/g,' '));
    check('reduced-motion readout shows result', /23\.2/.test(ro), ro);
    await p.close();
  }

  // 6. no-WebGL fallback renders the flat mark
  {
    const p = await b.newPage({ viewport:{width:1440,height:900} });
    await p.addInitScript(()=>{ HTMLCanvasElement.prototype.getContext = ()=>null; });
    await p.goto(base,{waitUntil:'load'});
    await p.waitForTimeout(1200);
    const hasSvg = await p.evaluate(()=>!!document.querySelector('.gl-frame svg'));
    check('no-webgl fallback shows the svg mark', hasSvg);
    await p.locator('.gl-frame').screenshot({ path: ROOT+'/.shots/fallback.png' });
    await p.close();
  }

  // 7. reduced-motion + no-webgl together
  {
    const p = await b.newPage({ viewport:{width:390,height:844}, reducedMotion:'reduce' });
    await p.addInitScript(()=>{ HTMLCanvasElement.prototype.getContext = ()=>null; });
    await p.goto(base,{waitUntil:'load'});
    await p.waitForTimeout(1000);
    const hasSvg = await p.evaluate(()=>!!document.querySelector('.gl-frame svg'));
    check('no-webgl + reduced-motion fallback', hasSvg);
    await p.close();
  }

  // 8. download link resolves
  {
    const p = await b.newPage();
    await p.goto(base,{waitUntil:'load'});
    await p.waitForTimeout(2500);
    const href = await p.$eval('[data-download]', e=>e.href);
    check('download link is a github URL', /github\.com/.test(href), href);
    await p.close();
  }

  console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
  await b.close(); srv.close();
  process.exit(fails?1:0);
})();
