
const { chromium } = require('/Users/priticolours/.hermes/cache/scratch/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT='/Users/priticolours/Desktop/cmprssr-site';
const srv = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
  try { const b=fs.readFileSync(path.join(ROOT,rel));
    res.writeHead(200,{'content-type': {'.svg':'image/svg+xml','.png':'image/png','.html':'text/html','.js':'text/javascript'}[path.extname(rel)]||'application/octet-stream'});
    res.end(b);
  } catch(e){ res.writeHead(404); res.end('nf'); }
});
(async()=>{
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
  const p = await b.newPage({ viewport:{width:980,height:300}, deviceScaleFactor:2 });
  const files=['mark.svg','lockup-horizontal.svg','favicon.svg','icon.svg'];
  await p.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'load'}).catch(()=>{});
  await p.setContent(`<body style="margin:0;background:#0b131a;display:flex;gap:20px;align-items:center;padding:20px;height:260px">
  ${files.map(f=>`<div style="text-align:center"><img src="http://127.0.0.1:${port}/assets/${f}" style="height:130px;background:#131d26;padding:10px;border-radius:8px"><div style="color:#8fa0ae;font:10px monospace;margin-top:6px">${f}</div></div>`).join('')}
  </body>`);
  await p.waitForTimeout(800);
  const broken = await p.$$eval('img', els => els.map(e=>e.naturalWidth));
  console.log('naturalWidths (0 = broken):', broken.join(','));
  await p.screenshot({ path: ROOT+'/.shots/assets-check.png' });
  await b.close(); srv.close();
})();
