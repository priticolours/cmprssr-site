/* ═══════════════════════════════════════════════════════════════════
   check-uniforms.js — assert locs() and the shaders agree

   WebGL fails silently on a missing uniform. getUniformLocation returns
   null for a name the compiler dropped, and every gl.uniform1f(null, x)
   is a no-op with no error and no console line. So renaming a uniform in
   a shader and forgetting it in locs() does not crash — the value just
   stays at 0, which for this renderer means an invisible point cloud or a
   black frame. That cost real time: the two-density refactor added
   uAlphaCloud/uAlphaWord/uSizeCloud/uSizeWord/uLogoScale, and the first
   draft of the locs() list was written before the shader was.

   Rather than trust a grep, compare both sides properly: pull every
   uniform declared in VS_POINT/FS_POINT/VS_SOLID/FS_SOLID, pull every
   name passed to locs(), and report the difference in each direction.

     node tools/check-uniforms.js
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const GL = path.resolve(__dirname, '..', 'gl.js');
const src = fs.readFileSync(GL, 'utf8');

/* Every uniform declared across all four shader sources. */
const declared = new Set();
for (const m of src.matchAll(/uniform\s+\w+\s+([^;]+);/g)) {
  for (const n of m[1].split(',')) {
    const name = n.trim();
    if (/^[A-Za-z_]\w*$/.test(name)) declared.add(name);
  }
}

/* Every name passed to locs(), for either program. */
const asked = new Set();
for (const m of src.matchAll(/locs\(gl, this\.p(?:Point|Solid), \[([\s\S]*?)\]\)/g)) {
  for (const n of m[1].split(',')) {
    const name = n.trim().replace(/^"|"$/g, '');
    if (name) asked.add(name);
  }
}

/* Uniforms the renderer actually sets inside draw() — the ones that go
   quiet if the location is null. */
const setInDraw = new Set();
const draw = src.slice(src.indexOf('Scene.prototype.draw'));
for (const m of draw.matchAll(/(?:su|pu)\.(u\w+)/g)) setInDraw.add(m[1]);

const missingFromLocs = [...declared].filter(n => !asked.has(n)).sort();
const missingFromShaders = [...asked].filter(n => !declared.has(n)).sort();
/* A uniform can be in locs() and used, and still never be assigned. */
const setButNotAsked = [...setInDraw].filter(n => !asked.has(n)).sort();
const askedNotSet = [...asked].filter(n => !setInDraw.has(n)).sort();

const line = (s) => console.log('  ' + s);
console.log(`declared in shaders: ${declared.size}`);
line([...declared].sort().join(' '));
console.log(`passed to locs():    ${asked.size}`);
line([...asked].sort().join(' '));
console.log(`assigned in draw():  ${setInDraw.size}`);
line([...setInDraw].sort().join(' '));
console.log('');

let bad = 0;
if (missingFromLocs.length) {
  console.log(`FAIL  ${missingFromLocs.length} uniform(s) declared but not in locs() — ` +
    'gl.uniform*(null) is a silent no-op, so these never take effect:');
  missingFromLocs.forEach(n => line(n));
  bad++;
}
if (missingFromShaders.length) {
  console.log(`FAIL  ${missingFromShaders.length} name(s) in locs() but not declared ` +
    'in any shader:');
  missingFromShaders.forEach(n => line(n));
  bad++;
}
if (setButNotAsked.length) {
  console.log(`FAIL  ${setButNotAsked.length} uniform(s) assigned in draw() but not in locs():`);
  setButNotAsked.forEach(n => line(n));
  bad++;
}
if (askedNotSet.length) {
  /* Not fatal: a uniform can be read only where it is declared. But on
     this renderer every one of them is meant to be driven per frame. */
  console.log(`WARN  ${askedNotSet.length} uniform(s) in locs() never assigned in draw():`);
  askedNotSet.forEach(n => line(n));
}

if (bad) {
  console.log(`\n${bad} PROBLEM(S)`);
  process.exit(1);
}
console.log('\nshader uniforms, locs() and draw() all agree');
