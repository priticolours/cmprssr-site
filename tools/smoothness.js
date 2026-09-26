/* Checks the motion for the two things that read as "not smooth":
 *   1. a POP — any place a scalar jumps more than its neighbours
 *   2. a SEAM — the loop wrap where value or slope discontinues
 * Run: node tools/smoothness.js */
/* The timeline is browser code, so it is lifted straight out of gl.js
   and evaluated here — the alternative is a copy that drifts out of
   sync with the real thing, which is worse than no test at all. */
const fs = require('fs');
const path = require('path');
const GL = path.join(__dirname, '..', 'gl.js');
const src = fs.readFileSync(GL, 'utf8');
const CYCLE = parseFloat((src.match(/var CYCLE = ([0-9.]+)/) || [])[1]);
if (!CYCLE) throw new Error('could not read CYCLE from gl.js');

const start = src.indexOf('function timeline');
const end = src.indexOf('Scene.prototype.draw');
if (start < 0 || end < 0) throw new Error('timeline() not found in gl.js');
const tlSrc = src.slice(start, end);

const factory = new Function('CYCLE', tlSrc + '; return timeline;');
const tl = factory(CYCLE);

const KEYS = ['explode','cloud','collapse','camAlpha','logoAlpha','pointAlpha','spin','tilt','zoom'];
const N = 3600;                 /* 250 samples/sec — finer than any display */
const dt = CYCLE / N;
const e = 1e-5;

let worst = 0, fail = 0;
for (const k of KEYS) {
  let maxJump = 0, atT = 0;
  for (let i = 0; i < N; i++) {
    const a = tl(i * dt)[k], b = tl((i + 1) * dt)[k];
    const d = Math.abs(b - a);
    if (d > maxJump) { maxJump = d; atT = i * dt; }
  }
  /* slope continuity across the wrap: a cosine/drift has matching slope
     at 0 and at CYCLE; a piecewise ramp does not */
  const s0 = (tl(e)[k] - tl(0)[k]) / e;
  const s1 = (tl(CYCLE - e)[k] - tl(CYCLE - 2 * e)[k]) / e;
  const valMis = Math.abs(tl(0)[k] - tl(CYCLE - 1e-9)[k]);
  const slopeJump = Math.abs(s0 - s1);

  /* threshold: a quintic over ~0.7s moves at most ~2.4/sec, and no
     single 4ms step should move any scalar more than 0.02 */
  const popOK = maxJump < 0.02;
  const seamOK = valMis < 1e-6 && slopeJump < 1e-3;
  if (!popOK || !seamOK) fail++;
  worst = Math.max(worst, maxJump);

  console.log(
    (popOK && seamOK ? 'PASS  ' : 'FAIL  ') + k.padEnd(11) +
    'maxStep=' + maxJump.toFixed(5) + ' @t=' + atT.toFixed(2) +
    '  valueGap=' + valMis.toExponential(1) +
    '  slopeGap=' + slopeJump.toExponential(1)
  );
}
/* A blank frame is its own kind of problem: a window that falls to zero
   while the next one has not risen yet reads as a blink, which is worse
   than any easing artefact. */
let thinnest = 1, at = 0;
for (let i = 0; i < 9000; i++) {
  const t = i / 1000;
  const s = tl(t);
  const visible = Math.max(s.logoAlpha, s.camAlpha, s.pointAlpha);
  if (visible < thinnest) { thinnest = visible; at = t; }
}
const noBlank = thinnest > 0.10;
if (!noBlank) fail++;
console.log((noBlank ? 'PASS  ' : 'FAIL  ') + 'never blank'.padEnd(16) +
  'thinnest frame ' + thinnest.toFixed(3) + ' @ t=' + at.toFixed(2) + 's');

console.log(fail ? '\n' + fail + ' PROBLEM(S)' : '\nno pops, seam is continuous, never blank');
