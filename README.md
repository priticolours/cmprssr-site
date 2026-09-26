# cmprssr-site

The public site for **cmprssr** — a native macOS app that batch-compresses
CinemaDNG footage into DNGs DaVinci Resolve can still grade at full raw
latitude.

**Live:** https://priticolours.github.io/cmprssr-site/

Built by [Carl Perkins](https://github.com/priticolours).

## What's here

```
index.html      the page
style.css       tokens, layout, type
mark.js         the logo — one source for every placement
gl.js           the 3D piece (raw WebGL2, no libraries)
stage3d.js      runs the piece, syncs the readout to its clock
page.js         scroll reveals + the download-state check
assets/         logo, favicons, social card
assets/models/  the Sigma fp mesh the 3D piece renders
dist/           exported video loops and stills
tools/          the generators (not needed to serve the site)
```

No build step, no dependencies, no external requests except the GitHub
releases check. Clone and serve the folder with anything — but see
*Serving* below, because the 3D piece needs an http origin.

## The logo

Two things, both generated, and they share one source.

The **mark** is two rectangles — glass on the left, sensor on the right. It
is the icon and the app mark.

The **wordmark** is the text `cmprssr` as real glyph outlines, converted from
pango at build time so it renders identically on every machine rather than
depending on a system font. `tools/build-wordmark.mjs` writes three files
from those outlines: `wordmark.svg` (what the header masks), and
`wordmark-mask.png` + `wordmark-target.bin` (what the 3D particles land on).
The header and the point cloud are therefore the same letterforms, not two
drawings that look similar.

The font is **DejaVu Sans Mono Bold** (SIL OFL 1.1). It was SF Mono first,
which is Apple’s font and not redistributable as outlines — baking those into
a public repo’s assets would ship a font nobody had licensed.

## The 3D piece

Nine seconds, seamless loop: the wordmark holds → the particles disperse and
the fp converges from its exploded state → it holds → it opens along its
optical axis → it dissolves into a 150k-point cloud → the cloud contracts
back into the wordmark, letter by letter.

There is no separate logo object in the scene. The wordmark *is* the point
cloud at rest: the same 150k particles that spell the word are the ones that
become the camera. That is why the loop closes cleanly — one object changing
state, not a hand-off between two things.

The camera is the **real Sigma fp** — the scan in `DUMP/fp model`, not a
stand-in. `tools/stl-to-blob.py` reduces 59,992 triangles to 42,000, bakes the
Z-up-to-Y-up rotation into the coordinates, normalises the longest axis to 1.0,
and writes a flat interleaved blob (`assets/models/sigma-fp.bin`, 1.1MB) plus
a JSON header. No glTF, because parsing accessor tables in the page for one
untextured mesh would be several hundred lines to save nothing.

The body is cut into five stages along its own optical axis, so the explode
is a real teardown of the real geometry.

Raw WebGL2. Every point carries three positions — on the mesh, scattered in
the cloud, and on the wordmark — and one vertex shader lerps between them, so
the handoff is exact rather than approximate.

### Point density is arithmetic, not taste

The blend is additive, so a point’s contribution accumulates with every
neighbour that overlaps it. At 150k the wordmark packs those points onto an
inked area of about 6% of the frame, so each point must be near 1px — at 3px
they oversubscribe the ink 40× and fuse into a solid white slab with no
legible letters. The same 1px points spread over a volume would make the cloud
too sparse to see, so **point size and alpha both lerp on `d`**, the same 0→1
that drives the position mix. The cloud and the settled wordmark get separate
values.

`tools/tune-points.js` sweeps the pair and scores candidates on measured
framebuffer statistics (clipped fraction, lit fraction, peak) rather than on
how a screenshot looks. It is worth re-running if the count or the wordmark
width ever changes.

### Why the motion is built the way it is

The first version was a chain of `if/else` phases, each with its own cubic
ease. It looked mechanical no matter how the easing was tuned, because at
every phase boundary the velocity snapped to zero and back up — a visible
heartbeat. The current version uses two primitives:

```js
band(a, b)          // quintic ramp, 0 → 1 across [a, b]
win(a, b, c, d)     // band(a,b) * (1 - band(c,d))  — a WINDOW
```

Windows are what make a loop cyclic. A plain ramp starts at 0 and ends at 1,
which leaves the wrap with a hard 1→0 cut. A window rises and falls, so its
value *and* slope are both 0 at each end; stack overlapping windows and nothing
cuts, including at t=0/t=CYCLE. The camera drift is a pure cosine for the same
reason — its value and slope match at the wrap by construction.

Quintic rather than cubic because `6t⁵-15t⁴+10t³` has zero first *and* second
derivative at both ends, so a ramp eases in and out without the settle a cubic
leaves behind.

`tools/smoothness.js` is the regression test. It lifts `timeline()` straight
out of `gl.js` (rather than duplicating it, which would drift) and checks three
things at 250 samples/second:

- no scalar moves more than 0.02 in a single 4ms step — a pop;
- value *and* slope at t=0 match t=CYCLE — a seam;
- something is always on screen — a window that bottoms out at zero reads as a
  blink, which is worse than any easing artefact.

It is wired into `verify.js` as check 14.

## Serving

`gl.js` fetches the mesh, and `fetch()` is blocked on the `file:` origin, so
opening `index.html` straight from Finder renders the page with a flat mark
where the 3D should be. Serve it over http:

```bash
python3 -m http.server 8000    # → http://localhost:8000
```

## Regenerating

```bash
node tools/export-motion.mjs --fps 60 --size 1080   # → dist/
node tools/export-assets.mjs                        # → assets/
node tools/verify.js                                 # 14 checks
```

`verify.js` covers asset resolution, console errors, horizontal overflow at
five widths, that the canvas is genuinely painting, reduced-motion (must be
byte-identical across frames), the no-WebGL fallback, and the motion itself
via `smoothness.js`.

`tools/whowide.js <width>` names the exact elements causing an overflow
instead of reporting a pixel count — worth reaching for first when a width
fails.

The Blender script regenerates the mesh from source:

```bash
blender --background --python tools/stl-to-blob.py
```

The fp is Z-up, so it needs a quarter turn about x to stand upright and
face the viewer. That constant is `BASE_PITCH` in `gl.js`, and it was found
by sweeping the pitch through the page's own renderer and looking at the
result — not by reasoning about axis conventions, and not by measuring the
mesh. Blender's `rotation_euler` and `gl.js`'s `rotX` disagree about axis
order, so a Blender render cannot answer the question. Measure the mesh
extents to check the export is sane; use `tools/pose.html` to choose the
pose.

```bash
node tools/pose.js          # eight base pitches, side by side
node tools/one.js 2.4       # one large frame at t=2.4
```

## Deployment

GitHub Pages, publishing `main` from the repo root. The one external request
the page makes is a GitHub releases API call that decides whether the
download button points at a real `.dmg` or at the releases page while the
app is in beta.
