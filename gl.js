/* ═══════════════════════════════════════════════════════════════════
   gl.js — the cmprssr 3D motion graphic

   Raw WebGL2, no libraries. One animation, 9 seconds, seamless loop:

     0.0 – 1.2   WORDMARK    the particles already spell "cmprssr"
     1.2 – 2.8   ASSEMBLE    they disperse and the fp converges
     2.8 – 3.6   HOLD        assembled, drifting
     3.6 – 5.0   TEARDOWN    the real body separates along its optical axis
     4.2 – 5.0   DISSOLVE    the fp becomes a point cloud (overlaps)
     5.2 – 6.2   CONDENSE    the cloud contracts back into the wordmark
     6.0 – 9.0   WORDMARK    held, letter by letter

   There is no separate logo object. The wordmark IS the point cloud at
   rest: the same 150k particles that spell "cmprssr" are the ones that
   become the camera. That is why the loop closes cleanly — there is no
   hand-off between two things, only one object that changes state.

   Those 150k targets are sampled offline by tools/build-wordmark.mjs
   from pango outlines of the text, and the page's own header masks the
   same SVG file, so the endpoint is the wordmark you can read at the top
   of the page and not an approximation of it. (It replaced a two-box
   stand-in that read as two unrelated rectangles.)

   Nothing cuts. Every transition is a quintic over an overlapping
   window, and the camera drift is a single slow cosine, so t=0 and
   t=CYCLE share both value and slope and the seam is invisible.
   tools/smoothness.js asserts exactly that, numerically.

   The camera is the real Sigma fp, from the scan in
   DUMP/fp model, sliced into five stages along its own optical axis
   (see tools/stl-to-blob.py). It is not a stand-in.

   Why no library: the whole thing is one vertex shader that lerps a
   point between three positions — on the mesh, scattered in the cloud,
   and on the wordmark. Three.js would be 600KB to do arithmetic I can do
   in 40 lines, and the page has no external requests by design.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var CYCLE = 9.0;

  /* The fp is a black magnesium body, so the greys sit dark — but not so
     dark that the new fill light has nothing to lift. These are the
     albedo values, before lighting. */
  var C = {
    lens:  [0.86, 0.92, 0.95],
    steel: [0.62, 0.70, 0.76],
    body:  [0.44, 0.52, 0.59],
    bodyLo:[0.32, 0.39, 0.46],
    signal:[0.96, 0.42, 0.18],
    /* the header's --fg. The cloud's final pass takes this so the
       particles and the page's own text are the same ink. */
    ink:   [0.933, 0.949, 0.961]
  };

  /* ── tiny mat4 ───────────────────────────────────────────────── */
  function m4() { return new Float32Array(16); }

  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out[0]=f/aspect; out[1]=0; out[2]=0;  out[3]=0;
    out[4]=0; out[5]=f; out[6]=0; out[7]=0;
    out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
    out[12]=0; out[13]=0; out[14]=2*far*near*nf; out[15]=0;
    return out;
  }

  function lookAt(out, eye, at, up) {
    var z0=eye[0]-at[0], z1=eye[1]-at[1], z2=eye[2]-at[2];
    var l = 1/Math.hypot(z0,z1,z2); z0*=l; z1*=l; z2*=l;
    var x0=up[1]*z2-up[2]*z1, x1=up[2]*z0-up[0]*z2, x2=up[0]*z1-up[1]*z0;
    l = Math.hypot(x0,x1,x2); l = l ? 1/l : 0; x0*=l; x1*=l; x2*=l;
    var y0=z1*x2-z2*x1, y1=z2*x0-z0*x2, y2=z0*x1-z1*x0;
    out[0]=x0; out[1]=y0; out[2]=z0; out[3]=0;
    out[4]=x1; out[5]=y1; out[6]=z1; out[7]=0;
    out[8]=x2; out[9]=y2; out[10]=z2; out[11]=0;
    out[12]=-(x0*eye[0]+x1*eye[1]+x2*eye[2]);
    out[13]=-(y0*eye[0]+y1*eye[1]+y2*eye[2]);
    out[14]=-(z0*eye[0]+z1*eye[1]+z2*eye[2]);
    out[15]=1;
    return out;
  }

  function mul(out, a, b) {
    for (var i = 0; i < 4; i++) {
      var b0=b[i*4], b1=b[i*4+1], b2=b[i*4+2], b3=b[i*4+3];
      out[i*4]   = b0*a[0] + b1*a[4] + b2*a[8]  + b3*a[12];
      out[i*4+1] = b0*a[1] + b1*a[5] + b2*a[9]  + b3*a[13];
      out[i*4+2] = b0*a[2] + b1*a[6] + b2*a[10] + b3*a[14];
      out[i*4+3] = b0*a[3] + b1*a[7] + b2*a[11] + b3*a[15];
    }
    return out;
  }

  function rotY(out, a) {
    var s = Math.sin(a), c = Math.cos(a);
    out[0]=c;  out[1]=0; out[2]=-s; out[3]=0;
    out[4]=0;  out[5]=1; out[6]=0;  out[7]=0;
    out[8]=s;  out[9]=0; out[10]=c; out[11]=0;
    out[12]=0; out[13]=0; out[14]=0; out[15]=1;
    return out;
  }

  function rotX(out, a) {
    var s = Math.sin(a), c = Math.cos(a);
    out[0]=1; out[1]=0; out[2]=0;  out[3]=0;
    out[4]=0; out[5]=c; out[6]=s;  out[7]=0;
    out[8]=0; out[9]=-s; out[10]=c; out[11]=0;
    out[12]=0; out[13]=0; out[14]=0; out[15]=1;
    return out;
  }

  /* ── mesh builders ─────────────────────────────────────────────
     Deliberately low-poly. These are technical components seen at
     three-quarter view, not a product render — faceted geometry reads
     as engineering, which is the whole point of the mark. */
  function box(w, h, d) {
    var x = w/2, y = h/2, z = d/2;
    var p = [], n = [], idx = [];
    var faces = [
      [[ x,-y,-z],[ x, y,-z],[ x, y, z],[ x,-y, z],[1,0,0]],
      [[-x,-y, z],[-x, y, z],[-x, y,-z],[-x,-y,-z],[-1,0,0]],
      [[-x, y,-z],[-x, y, z],[ x, y, z],[ x, y,-z],[0,1,0]],
      [[-x,-y, z],[-x,-y,-z],[ x,-y,-z],[ x,-y, z],[0,-1,0]],
      [[-x,-y, z],[ x,-y, z],[ x, y, z],[-x, y, z],[0,0,1]],
      [[ x,-y,-z],[-x,-y,-z],[-x, y,-z],[ x, y,-z],[0,0,-1]]
    ];
    for (var f = 0; f < faces.length; f++) {
      var F = faces[f], b = p.length/3;
      for (var v = 0; v < 4; v++) { p.push(F[v][0],F[v][1],F[v][2]); n.push(F[4][0],F[4][1],F[4][2]); }
      idx.push(b,b+1,b+2, b,b+2,b+3);
    }
    return { pos:p, nrm:n, idx:idx };
  }

  /* Tube along X. `inner > 0` makes it an open barrel. */
  function tube(rOut, rIn, len, seg) {
    var p = [], n = [], idx = [], i, a0, a1, c0, s0, c1, s1;
    for (i = 0; i < seg; i++) {
      a0 = (i/seg) * Math.PI*2; a1 = ((i+1)/seg) * Math.PI*2;
      c0 = Math.cos(a0); s0 = Math.sin(a0); c1 = Math.cos(a1); s1 = Math.sin(a1);
      var hx = len/2;
      /* outer wall */
      var b = p.length/3;
      p.push(-hx, s0*rOut, c0*rOut, -hx, s1*rOut, c1*rOut, hx, s1*rOut, c1*rOut, hx, s0*rOut, c0*rOut);
      for (var q = 0; q < 4; q++) n.push(0, s0, c0);
      n[3*0+1]=s0; n[3*0+2]=c0; n[3*1+1]=s1; n[3*1+2]=c1; n[3*2+1]=s1; n[3*2+2]=c1; n[3*3+1]=s0; n[3*3+2]=c0;
      idx.push(b,b+1,b+2, b,b+2,b+3);
      /* inner wall (flipped) */
      if (rIn > 0) {
        var b2 = p.length/3;
        p.push(-hx, s0*rIn, c0*rIn, hx, s0*rIn, c0*rIn, hx, s1*rIn, c1*rIn, -hx, s1*rIn, c1*rIn);
        n[3*4+1]=-s0; n[3*4+2]=-c0; n[3*5+1]=-s0; n[3*5+2]=-c0;
        n[3*6+1]=-s1; n[3*6+2]=-c1; n[3*7+1]=-s1; n[3*7+2]=-c1;
        idx.push(b2,b2+1,b2+2, b2,b2+2,b2+3);
      }
    }
    return { pos:p, nrm:n, idx:idx };
  }

  /* A flat disc facing along X — the front element. */
  function disc(r, seg, thick) {
    var p = [], n = [], idx = [];
    var hx = (thick||0.06)/2;
    for (var i = 0; i < seg; i++) {
      var a0 = (i/seg)*Math.PI*2, a1 = ((i+1)/seg)*Math.PI*2;
      var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      var b = p.length/3;
      /* front face */
      p.push(-hx, 0, 0, -hx, s0*r, c0*r, -hx, s1*r, c1*r);
      n.push(-1,0,0, -1,0,0, -1,0,0);
      idx.push(b,b+1,b+2);
      var b2 = p.length/3;
      /* back face */
      p.push(hx, 0, 0, hx, s1*r, c1*r, hx, s0*r, c0*r);
      n.push(1,0,0, 1,0,0, 1,0,0);
      idx.push(b2,b2+1,b2+2);
      /* rim */
      var b3 = p.length/3;
      p.push(-hx, s0*r, c0*r, hx, s0*r, c0*r, hx, s1*r, c1*r, -hx, s1*r, c1*r);
      n.push(0,s0,c0, 0,s0,c0, 0,s1,c1, 0,s1,c1);
      idx.push(b3,b3+1,b3+2, b3,b3+2,b3+3);
    }
    return { pos:p, nrm:n, idx:idx };
  }

  /* The logo: two rectangles. Left is glass, right is the sensor.
     These are the endpoint the whole animation contracts into, and the
     same two rectangles are the app's icon form. */
  /* ── the wordmark the cloud contracts into ────────────────────
     Sampled offline from the same pango outlines the page's header
     renders, so the particles land on the letterforms that are
     actually on screen rather than on an approximation of them.

     This replaced a two-box "logo" that was a stand-in and read as
     two unrelated rectangles — the one thing the motion must not
     end on. The blob is xyz float32, y-up, centred, z=0. */
  function loadWordmark(url) {
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("wordmark " + r.status);
        return r.json();
      })
      .then(function (meta) {
        return fetch(url.replace(/\.json$/, ".bin"))
          .then(function (r) {
            if (!r.ok) throw new Error("wordmark bin " + r.status);
            return r.arrayBuffer();
          })
          .then(function (buf) {
            /* Validate before trusting it: a short read would otherwise
               become a Float32Array of NaN and the cloud would vanish
               with no error anywhere. */
            var want = meta.count * 3 * 4;
            if (buf.byteLength !== want) {
              throw new Error("wordmark bin is " + buf.byteLength +
                              "B, expected " + want + "B");
            }
            return { meta: meta, pts: new Float32Array(buf) };
          });
      });
  }

  /* ── the camera, as five parts along the optical axis ─────────── */
  function cameraParts() {
    return [
      { id:"element", mesh: disc(0.62, 28, 0.10),  x:-1.34, dir:-1, dist:1.15, color:C.lens  },
      { id:"barrel",  mesh: tube(0.52, 0.40, 0.62, 26), x:-0.60, dir:-1, dist:0.62, color:C.steel },
      { id:"mount",   mesh: tube(0.46, 0.30, 0.10, 26), x:-0.16, dir:-1, dist:0.20, color:C.body  },
      { id:"sensor",  mesh: box(0.11, 0.80, 0.98), x: 0.34, dir: 1, dist:0.34, color:C.signal },
      { id:"rear",    mesh: box(0.52, 1.06, 1.14), x: 0.94, dir: 1, dist:1.05, color:C.body  }
    ];
  }

  /* ── surface sampling ─────────────────────────────────────────
     Area-weighted barycentric sampling, so the cloud has the same
     visual density everywhere instead of clustering at dense verts. */
  function sampleSurface(mesh, count, rnd) {
    var tris = mesh.idx.length / 3;
    var areas = new Float64Array(tris), total = 0, i, t;
    for (t = 0; t < tris; t++) {
      var a = mesh.idx[t*3]*3, b = mesh.idx[t*3+1]*3, c = mesh.idx[t*3+2]*3;
      var ux = mesh.pos[b]-mesh.pos[a], uy = mesh.pos[b+1]-mesh.pos[a+1], uz = mesh.pos[b+2]-mesh.pos[a+2];
      var vx = mesh.pos[c]-mesh.pos[a], vy = mesh.pos[c+1]-mesh.pos[a+1], vz = mesh.pos[c+2]-mesh.pos[a+2];
      var cx = uy*vz-uz*vy, cy = uz*vx-ux*vz, cz = ux*vy-uy*vx;
      var ar = 0.5*Math.hypot(cx,cy,cz);
      areas[t] = ar; total += ar;
    }
    var cum = new Float64Array(tris), run = 0;
    for (t = 0; t < tris; t++) { run += areas[t]; cum[t] = run; }

    var out = new Float32Array(count*3);
    for (i = 0; i < count; i++) {
      var target = rnd()*total, lo = 0, hi = tris-1;
      while (lo < hi) { var mid = (lo+hi)>>1; if (cum[mid] < target) lo = mid+1; else hi = mid; }
      t = lo;
      a = mesh.idx[t*3]*3; b = mesh.idx[t*3+1]*3; c = mesh.idx[t*3+2]*3;
      var u = rnd(), v = rnd();
      if (u+v > 1) { u = 1-u; v = 1-v; }
      out[i*3]   = mesh.pos[a]   + u*(mesh.pos[b]-mesh.pos[a])   + v*(mesh.pos[c]-mesh.pos[a]);
      out[i*3+1] = mesh.pos[a+1] + u*(mesh.pos[b+1]-mesh.pos[a+1]) + v*(mesh.pos[c+1]-mesh.pos[a+1]);
      out[i*3+2] = mesh.pos[a+2] + u*(mesh.pos[b+2]-mesh.pos[a+2]) + v*(mesh.pos[c+2]-mesh.pos[a+2]);
    }
    return out;
  }

  /* deterministic RNG — the exported video must match the page frame
     for frame, so nothing here may touch Math.random() */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ── the fp sliced into exploded stages ──────────────────────
     Each stage is a subset of the scan's own triangles, so the teardown
     keeps the real silhouette of the real body. Stage 2 (the mount /
     front) carries the accent, because that is where the lens — and so
     the thing being compressed behind — lives. */
  /* The fp is a black magnesium body, so it is painted in greys and the
     accent is reserved for the single stage that matters: the mount,
     where the compressed sensor sits behind the glass. Painting every
     stage in the accent turned the whole camera orange. */
  var FP_STAGE_COL = [
    C.steel,   /* 0 front cap */
    C.signal,  /* 1 lens mount — the one accent, and the smallest stage */
    C.body,    /* 2 mid body */
    C.body,    /* 3 rear plate */
    C.bodyLo   /* 4 back cap */
  ];
  /* Travel is along the optical axis (+z is the front). The front
     stages push toward the viewer and the rear stages pull away, so
     the body opens up along the axis a lens actually sits on. Values
     are in normalised units (body is 1.0 long) and scaled by
     uExplode, so 0.6 is most of half the body length. */
  /* Base orientation of the fp. The scan is Z-up, so its height axis
     needs a quarter turn about x to stand the body on its feet and face
     the lens mount at the orbit camera on +z. Found by rendering the
     mesh at a grid of rotations and looking for the frame with the
     mount (tools/fp-poses.py).
     The timeline's own spin and tilt are added on top of this. */
  var BASE_YAW = 0.0;
  var BASE_PITCH = -Math.PI / 2;

  var FP_STAGE_TRAVEL = [0.78, 0.50, 0.20, -0.34, -0.66];
  var FP_STAGE_DIR = [1, 1, 1, -1, -1];

  function fpParts(fp, st) {
    var parts = [];
    for (var s = 0; s < 5; s++) {
      parts.push({
        id: "stage" + s,
        mesh: null,                 /* filled below from the slice */
        x: 0,                       /* explode offset along the axis */
        dir: FP_STAGE_DIR[s],
        dist: FP_STAGE_TRAVEL[s],
        color: FP_STAGE_COL[s],
        stage: s
      });
    }

    /* bucket triangles by the stage of their first vertex */
    var buckets = [[], [], [], [], []];
    var idx = fp.idx, stageOf = st.stageOf;
    for (var t = 0; t < idx.length; t += 3) {
      buckets[stageOf[idx[t]]].push(idx[t], idx[t+1], idx[t+2]);
    }

    for (var s2 = 0; s2 < 5; s2++) {
      var tri = buckets[s2];
      var used = {};
      var order = [];
      for (var q = 0; q < tri.length; q++) {
        var v = tri[q];
        if (!(v in used)) { used[v] = order.length; order.push(v); }
      }
      var pos = new Float32Array(order.length * 3);
      var nrm = new Float32Array(order.length * 3);
      for (var w = 0; w < order.length; w++) {
        var vi = order[w];
        pos[w*3]   = fp.pos[vi*3];
        pos[w*3+1] = fp.pos[vi*3+1];
        pos[w*3+2] = fp.pos[vi*3+2];
        nrm[w*3]   = fp.nrm[vi*3];
        nrm[w*3+1] = fp.nrm[vi*3+1];
        nrm[w*3+2] = fp.nrm[vi*3+2];
      }
      var ix = new Array(tri.length);
      for (var r = 0; r < tri.length; r++) ix[r] = used[tri[r]];
      parts[s2].mesh = { pos: pos, nrm: nrm, idx: ix };
      parts[s2].vertCount = order.length;
    }
    return parts;
  }

  /* ── the Sigma fp ─────────────────────────────────────────────
     Real geometry from the scan, not a stand-in. Loaded as a flat
     binary blob (see tools/stl-to-blob.py) rather than glTF, because
     this is a single untextured mesh and parsing glTF's accessor
     tables in the page would be several hundred lines to save nothing.

     The blob arrives Y-up with the lens mount facing -x, centred on
     its bounding box with the longest axis normalised to 1. */
  function loadFP(url) {
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("fp " + r.status);
        return r.json();
      })
      .then(function (meta) {
        return fetch(url.replace(/\.json$/, ".bin"))
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (buf) {
            var f32 = new Float32Array(buf, meta.posOffset, meta.vertices * 3);
            var nrm = new Float32Array(buf, meta.nrmOffset, meta.vertices * 3);
            var u32 = new Uint32Array(buf, meta.idxOffset, meta.indexCount);
            /* The scan is a real object, so it is grey rather than
               brand-orange. The sensor still reads as the accent
               because it is where the orange accent geometry sits. */
            return { meta: meta, pos: f32, nrm: nrm, idx: u32 };
          });
      });
  }

  /* ── the fp, exploded along its optical axis ──────────────────
     The scan is one closed shell, so an "exploded view" has to assign
     vertices to stages by their position along -x (the front-to-back
     axis). That gives a genuine teardown of the real body rather than
     five primitives pretending to be a camera. */
  function fpStages(fp) {
    var p = fp.pos, n = fp.meta.vertices;
    /* Bucket along the optical axis. The scan is Z-up, so its height
       axis is what becomes "front-to-back" once the model is stood
       upright by BASE_PITCH — the lens mount normal. Stage 0 and 1 sit
       near the mount, 4 at the rear. */
    var minA = 1e30, maxA = -1e30;
    var i, a;
    for (i = 0; i < n; i++) { a = p[i*3+1]; if (a < minA) minA = a; if (a > maxA) maxA = a; }
    var span = maxA - minA;

    /* 5 bands across the depth of the body: front cap, lens mount and
       front plate, mid-body, rear plate, back cap. */
    /* The mount is a thin ring at the very front of the body, so its
       band is narrow (0.04-0.13) rather than a quarter of the depth. */
    var EDGES = [0.00, 0.04, 0.13, 0.55, 0.84, 1.00];
    var stageOf = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var t = (p[i*3+1] - minA) / span;
      var s = 0;
      while (s < 4 && t > EDGES[s+1]) s++;
      stageOf[i] = s;
    }
    return { stageOf: stageOf, minA: minA, span: span };
  }

  /* ── shaders ─────────────────────────────────────────────────
     The position chunk is shared by the solid and point programs so
     both agree exactly on where everything is at any t. */
  var VS_SOLID = [
    "#version 300 es",
    "in vec3 aPos; in vec3 aNrm; in vec3 aCol;",
    "in float aDir; in float aDist;",
    "uniform mat4 uProj, uView, uModel, uNormalMat;",
    "uniform float uExplode, uAlpha;",
    "out vec3 vNrm; out vec3 vCol; out float vAlpha; out vec3 vView;",
    "void main() {",
    /* The camera is a solid and stays a solid: only the point cloud
       collapses. Keeping aDist here (and nothing else) is what makes
       the teardown a real disassembly rather than a scale-down. */
    "  vec3 p = aPos + aDir * aDist * uExplode;",
    "  vec4 world = uModel * vec4(p, 1.0);",
    "  vView = world.xyz;",
    "  vNrm = normalize(mat3(uModel) * aNrm);",
    "  vCol = aCol; vAlpha = uAlpha;",
    "  gl_Position = uProj * uView * world;",
    "}"
  ].join("\n");


  /* Three-point rig rather than one light. A single directional with a
     low ambient leaves every face perpendicular to it black, which is
     why the fp read as a dark smudge whenever it drifted off-axis. The
     fill is what keeps the form legible from any angle, and the soft
     key with a wide falloff is closer to how a product shot is lit
     than a hard specular hit. */
  var FS_SOLID = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vNrm; in vec3 vCol; in float vAlpha; in vec3 vView;",
    "uniform float uAlpha;",
    "out vec4 o;",
    "void main() {",
    "  vec3 N = normalize(vNrm);",
    "  vec3 V = normalize(-vView);",
    /* key, high and slightly to the right, soft */
    "  vec3 K = normalize(vec3(0.55, 0.82, 0.70));",
    /* fill, low and to the left, broad and weak */
    "  vec3 F = normalize(vec3(-0.70, -0.15, 0.45));",
    /* rim, from behind and above, to separate the body from the page */
    "  vec3 R = normalize(vec3(-0.30, 0.55, -0.78));",
    "  float k = max(dot(N, K), 0.0);",
    "  float f = max(dot(N, F), 0.0);",
    "  float r = max(dot(N, R), 0.0);",
    /* wrapped diffuse: the term that stops the unlit side going flat */
    "  float wrap = max((dot(N, K) + 0.45) / 1.45, 0.0);",
    "  vec3 H = normalize(K + V);",
    "  float sp = pow(max(dot(N, H), 0.0), 34.0) * 0.30;",
    "  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
    "  vec3 c = vCol * (0.34 + 0.52 * k + 0.16 * f)",
    "        + vCol * wrap * 0.20",
    "        + vCol * r * 0.26",
    "        + vec3(0.62, 0.78, 0.88) * rim * 0.22",
    "        + vec3(sp);",
    "  o = vec4(c, uAlpha);",
    "}"
  ].join("\n");

  var VS_POINT = [
    "#version 300 es",
    "in vec3 aPos; in vec3 aCol;",
    "in float aDir; in float aDist; in vec3 aScatter; in vec3 aLogo;",
    "in float aDelay;",
    "uniform mat4 uProj, uView, uModel;",
    "uniform float uExplode, uCloud, uDelay;",
    "uniform float uAlpha, uAlphaCloud, uAlphaWord;",
    "uniform float uSizeCloud, uSizeWord, uPixel;",
    /* The wordmark is authored flat facing the camera, so it needs a depth.
       The fp's centre sits at view z = -dist, so -dist puts the letters at
       the same distance as the camera they came from — the dissolve is then
       a pure lateral movement, with no scale jump at the crossover. */
    "uniform float uLogoZ, uLogoScale;",
    "uniform vec3 uLogoCol;",
    "out vec3 vCol; out float vAlpha; out float vD;",
    "void main() {",
    "  vec3 pEx = aPos + aDir * aDist * uExplode;",
    "  vec3 pSc = mix(pEx, pEx + aScatter, uCloud);",
    /* Mix in VIEW space, after the model and view transforms. Pushing the
       wordmark through a model inverse was the obvious route — but a
       hand-rolled 4x4 inverse is a bug waiting to happen, and mine was
       wrong by exactly 1.0, which threw every letterform outside the
       frustum. Transforming forward cannot get the two spaces out of step. */
    "  vec3 viewPos = (uView * uModel * vec4(pSc, 1.0)).xyz;",
    /* Per-point stagger, so the wordmark assembles left to right the way
       an eye reads it. The 0.35 spread is scaled back out by the divide, so
       every point still reaches exactly 1.0 when uDelay does and the loop's
       wrap stays seamless. */
    "  float d = clamp((uDelay - aDelay * 0.35) / 0.65, 0.0, 1.0);",
    "  vec3 p = mix(viewPos, aLogo * uLogoScale + vec3(0.0, 0.0, uLogoZ), d);",
    "  vec4 vp = vec4(p, 1.0);",
    "  gl_Position = uProj * vp;",
    /* Point size tracks d, the same 0..1 that drives the position mix.
       A single size cannot serve both states: at the wordmark the 150k
       points pack onto an inked area of ~6% of the frame, so they must
       be ~1px or they fuse into a solid slab and the letterforms
       vanish. The same 1px points spread over a volume leave the cloud
       so sparse it disappears. So the points shrink as they converge,
       which also reads as condensing. */
    "  gl_PointSize = clamp(mix(uSizeCloud, uSizeWord, d)",
    "                    * uPixel / max(-vp.z, 0.05), 1.0, 64.0);",
    /* Cloud keeps the camera's stage colours; the wordmark takes the
       header's ink, so the two are visibly the same object. */
    "  vCol = mix(aCol, uLogoCol, d);",
    "  vAlpha = uAlpha; vD = d;",
    "}"
  ].join("\n");

  var FS_POINT = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vCol; in float vAlpha; in float vD;",
    "uniform float uAlpha, uAlphaCloud, uAlphaWord;",
    "out vec4 o;",
    "void main() {",
    "  vec2 d = gl_PointCoord - 0.5;",
    "  float r = dot(d, d);",
    "  if (r > 0.25) discard;",
    /* Soft shoulder, squared for a flat core. A hard disc shows faceting
       where neighbours overlap; a gaussian washes the letterforms out. */
    "  float a = 1.0 - smoothstep(0.04, 0.25, r);",
    "  a *= a;",
    /* Alpha has to differ between the two states by ~14x, because the
       cloud spreads 150k points over a volume while the wordmark packs the
       same 150k onto an inked area of only ~6% of the frame. One shared
       value is either a dim cloud or a white slab. vD is the same 0..1
       that drives the position mix, so brightness follows the geometry. */
    "  o = vec4(vCol, a * vAlpha * mix(uAlphaCloud, uAlphaWord, vD));",
    "}"
  ].join("\n");

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("shader: " + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error("link: " + gl.getProgramInfoLog(p));
    }
    return p;
  }

  function locs(gl, p, names) {
    var o = {};
    for (var i = 0; i < names.length; i++) o[names[i]] = gl.getUniformLocation(p, names[i]);
    return o;
  }

  /* ── the scene ───────────────────────────────────────────────── */
  function Scene(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    /* 150k is what the wordmark blob holds, so that is the ceiling —
       anything higher would only duplicate letters, and because the
       blend is additive, duplication is also brightness. */
    this.count = opts.count || 150000;
    /* Point size and alpha are opts so tools/tune-points.js can sweep
       them against measured framebuffer statistics, rather than someone
       guessing a number and reading it back off a screenshot. The
       defaults are what that sweep picked. */
    /* Point size and alpha are opts so tools/tune-points.js can sweep
       them against measured framebuffer statistics rather than someone
       guessing a number and reading it back off a screenshot. The
       defaults are the arithmetic, not a guess: see draw() for why
       cloud and wordmark each need their own. */
    this.sizeCloud  = opts.sizeCloud  !== undefined ? opts.sizeCloud  : 0.0040;
    this.sizeWord   = opts.sizeWord   !== undefined ? opts.sizeWord   : 0.0016;
    this.alphaCloud = opts.alphaCloud !== undefined ? opts.alphaCloud : 0.090;
    this.alphaWord  = opts.alphaWord  !== undefined ? opts.alphaWord  : 0.260;
    this.logoScale  = opts.logoScale  !== undefined ? opts.logoScale  : 1.15;
    this.clear = opts.clear || [0, 0, 0, 0];
    this.ok = false;

    var gl = canvas.getContext("webgl2", {
      alpha: true, antialias: true, premultipliedAlpha: false,
      powerPreference: "high-performance",
      /* Only when asked. preserveDrawingBuffer makes the buffer readable
         after compositing, which is what screenshot-based tooling needs
         to see a frame at all — but it costs a buffer copy every frame,
         so the page itself must not pay for it. */
      preserveDrawingBuffer: !!opts.preserve
    });
    if (!gl) return;
    this.gl = gl;

    try {
      this.pSolid = program(gl, VS_SOLID, FS_SOLID);
      this.pPoint = program(gl, VS_POINT, FS_POINT);
    } catch (e) {
      return;
    }

    this.uSolid = locs(gl, this.pSolid, ["uProj","uView","uModel",
      "uNormalMat","uExplode","uAlpha"]);
    /* Every name here must exist in the shader. A missing one returns a
       null location, and gl.uniform1f(null, x) is a SILENT no-op in WebGL
       — no error, no console line, just an invisible cloud. So this list
       is asserted against the sources by tools/check-uniforms.js. */
    this.uPoint = locs(gl, this.pPoint, ["uProj","uView","uModel",
      "uExplode","uCloud","uDelay",
      "uAlpha","uAlphaCloud","uAlphaWord",
      "uSizeCloud","uSizeWord","uPixel",
      "uLogoZ","uLogoScale","uLogoCol"]);

    var rnd = rng(0x5eed1a);
    this.rnd = rnd;
    var fp = opts.fp;
    if (!fp) return;                 /* no geometry, no scene */

    /* The real fp becomes five exploded stages along its own optical
       axis. Each stage is a slice of the scan, so the "explode" is a
       real teardown of the real body. */
    var st = fpStages(fp);
    var parts = fpParts(fp, st);
    var wm = opts.wm;
    if (!wm) return;                 /* no target, no cloud */

    this._buildSolid(parts);
    this._buildPoints(parts, wm, rnd);

    this.mProj = m4(); this.mView = m4(); this.mModel = m4();
    this.tmpA = m4(); this.tmpB = m4();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(this.clear[0], this.clear[1], this.clear[2], this.clear[3]);
    this.ok = true;
  }

  /* Solid geometry: camera parts + logo, each vertex carrying where it
     belongs in the explode and on the logo. */
  Scene.prototype._buildSolid = function (parts) {
    var gl = this.gl, V = 0, I = 0, k;
    for (k = 0; k < parts.length; k++) {
      V += parts[k].mesh.pos.length/3; I += parts[k].mesh.idx.length;
    }

    var pos = new Float32Array(V*3), nrm = new Float32Array(V*3),
        col = new Float32Array(V*3), dir = new Float32Array(V),
        dst = new Float32Array(V), idx = new Uint32Array(I);

    var vo = 0, io = 0, i;
    for (k = 0; k < parts.length; k++) {
      var mesh = parts[k].mesh, n = mesh.pos.length/3, base = vo;
      for (i = 0; i < n; i++) {
        pos[(base+i)*3]   = mesh.pos[i*3]   + parts[k].x;
        pos[(base+i)*3+1] = mesh.pos[i*3+1];
        pos[(base+i)*3+2] = mesh.pos[i*3+2];
        nrm[(base+i)*3]   = mesh.nrm[i*3];
        nrm[(base+i)*3+1] = mesh.nrm[i*3+1];
        nrm[(base+i)*3+2] = mesh.nrm[i*3+2];
        col[(base+i)*3]   = parts[k].color[0];
        col[(base+i)*3+1] = parts[k].color[1];
        col[(base+i)*3+2] = parts[k].color[2];
        dir[base+i] = parts[k].dir;
        dst[base+i] = parts[k].dist;
      }
      for (i = 0; i < mesh.idx.length; i++) idx[io++] = mesh.idx[i] + base;
      vo += n;
    }

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var self = this;
    function buf(name, data, size) {
      var loc = gl.getAttribLocation(this.pSolid, name);
      if (loc < 0) return;
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    [["aPos",pos,3], ["aNrm",nrm,3], ["aCol",col,3],
     ["aDir",new Float32Array(dir),1], ["aDist",new Float32Array(dst),1]
    ].forEach(function (a) { buf.call(self, a[0], a[1], a[2]); });

    var ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.solid = { vao:vao, count:idx.length };
  };

  /* The cloud: one point per sample, each knowing its mesh home, a
     scatter target, and a spot on the logo. */
  /* Point count is a function of surface area, not a fixed number: the
     fp is 1.0 long where the old primitives were 2.3, so the same count
     is roughly 5x denser per unit area. */
  Scene.prototype._buildPoints = function (parts, wm, rnd) {
    var gl = this.gl;
    var total = this.count;
    if (total > wm.pts.length/3) total = wm.pts.length/3;
    var wn = wm.pts.length/3;

    var pos = new Float32Array(total*3), col = new Float32Array(total*3),
        dir = new Float32Array(total), dst = new Float32Array(total),
        sca = new Float32Array(total*3), lgo = new Float32Array(total*3),
        dly = new Float32Array(total);

    /* Distribute samples across parts by area so the cloud keeps the
       camera's proportions instead of over-weighting the small bits. */
    var weights = [], sum = 0, k, i;
    for (k = 0; k < parts.length; k++) {
      var m = parts[k].mesh, tris = m.idx.length/3, a = 0;
      for (i = 0; i < tris; i++) {
        var ia = m.idx[i*3]*3, ib = m.idx[i*3+1]*3, ic = m.idx[i*3+2]*3;
        var ux=m.pos[ib]-m.pos[ia], uy=m.pos[ib+1]-m.pos[ia+1], uz=m.pos[ib+2]-m.pos[ia+2];
        var vx=m.pos[ic]-m.pos[ia], vy=m.pos[ic+1]-m.pos[ia+1], vz=m.pos[ic+2]-m.pos[ia+2];
        a += 0.5*Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
      }
      weights.push(a); sum += a;
    }

    var o = 0, nth = 0;
    for (k = 0; k < parts.length; k++) {
      var n = k === parts.length-1 ? total - o : Math.round(total * weights[k]/sum);
      var s = sampleSurface(parts[k].mesh, n, rnd);
      for (i = 0; i < n; i++) {
        var v = o + i;
        pos[v*3]   = s[i*3]   + parts[k].x;
        pos[v*3+1] = s[i*3+1];
        pos[v*3+2] = s[i*3+2];
        col[v*3]   = parts[k].color[0];
        col[v*3+1] = parts[k].color[1];
        col[v*3+2] = parts[k].color[2];
        dir[v] = parts[k].dir;
        dst[v] = parts[k].dist;
        /* Scatter is deliberately TIGHT. A wide scatter turns a dense
           cloud into generic starfield and the camera's silhouette is
           lost — the cloud has to still read as *this* camera, so the
           points stay close to where they were sampled and gain only
           enough jitter to look granular. */
        var th = rnd()*Math.PI*2, ph = Math.acos(2*rnd()-1);
        var edge = (k===0||k===4) ? 1.0 : 0.82;
        var rr = (0.30 + 0.78*Math.pow(rnd(), 0.55)) * edge;
        sca[v*3]   = Math.sin(ph)*Math.cos(th)*rr;
        sca[v*3+1] = Math.cos(ph)*rr*0.72;
        sca[v*3+2] = Math.sin(ph)*Math.sin(th)*rr;

        /* Wordmark target. The blob is already in rejection-sampling
           order, which is random, so walking it sequentially gives a
           random-but-even subset for free — and a fixed mapping means
           the page and the exported video show the same frame. A hash
           here would only add a way for two particles to collide into
           a visible clump. */
        var j = v % wn;
        lgo[v*3]   = wm.pts[j*3];
        lgo[v*3+1] = wm.pts[j*3+1];
        lgo[v*3+2] = wm.pts[j*3+2];
        /* Delay correlates with x, so the wordmark resolves left to
           right the way an eye reads it. */
        dly[v] = (lgo[v*3] / (wm.meta.width/2) + 1) * 0.5;
      }
      o += n;
    }

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var self = this;
    function buf(name, data, size) {
      var loc = gl.getAttribLocation(this.pPoint, name);
      if (loc < 0) return;
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    /* Size 3 for the vec3s, 1 for aDelay. Getting this wrong is silent
       and total: vertexAttribPointer with size 3 against a `total`-float
       buffer reads past the end, the draw raises INVALID_OPERATION and
       draws nothing at all, and every frame where the cloud is on screen
       comes back black. Cost an afternoon. */
    var map = { aPos:pos, aCol:col, aScatter:sca, aLogo:lgo };
    Object.keys(map).forEach(function (nm) { buf.call(self, nm, map[nm], 3); });
    buf.call(self, "aDir", dir, 1);
    buf.call(self, "aDist", dst, 1);
    buf.call(self, "aDelay", dly, 1);
    gl.bindVertexArray(null);
    this.points = { vao:vao, count:total };
  };

  /* ── timeline ─────────────────────────────────────────────────
     Everything the render needs, derived from t alone.

     The first version was a chain of if/else phases, each with its own
     ease. That reads as mechanical no matter how good the easing is,
     because at every phase boundary the velocity snaps to zero and
     back up — the motion has a visible heartbeat.

     This version is built from two primitives instead:

       band(a, b)  a quintic ramp from 0 to 1 across [a, b]
       win(a,b,c,d) band(a,b) * (1 - band(c,d))  — a WINDOW

     Windows are what make the loop cyclic. A plain ramp starts at 0
     and ends at 1, which leaves the wrap with a hard 1→0 cut; a
     window rises and falls, so its value AND slope are 0 at both
     ends. Stack the windows with overlapping edges and nothing ever
     cuts, including at t=0/t=CYCLE.

     The feel comes from the curve, not the phase structure: quintic
     (6t^5-15t^4+10t^3) has zero first AND second derivative at both
     ends, so it eases in and out without the visible settle a cubic
     leaves behind. */
  function timeline(t) {
    t = ((t % CYCLE) + CYCLE) % CYCLE;
    var S = { explode:0, cloud:0, collapse:0,
              camAlpha:0, pointAlpha:0, spin:0, tilt:0, zoom:1 };

    function band(a, b) { return quintic((t - a) / (b - a)); }
    function win(a, b, c, d) { return Math.min(band(a, b), 1 - band(c, d)); }

    /* — who is on screen ————————————————————————————————
       Two windows now, not three. The logo is not a separate object
       any more: the points ARE the wordmark, so the opening and
       closing beats are the cloud already settled rather than a
       hand-off to a second thing. That is what closes the seam. */
    var body = win(0.95, 1.75, 4.30, 5.05);      /* the fp        */
    var puff = win(4.15, 4.85, 5.85, 6.45);      /* the cloud     */

    /* The wordmark holds through the head of the loop, then the points
       disperse into the camera as it assembles, then they return. The
       leading window starts before t=0 and the trailing one never
       falls, so collapse is 1 at both ends of the cycle. */
    S.collapse  = Math.max(win(-0.30, -0.10, 0.95, 1.75), band(5.10, 6.20));
    /* Points are invisible only while the solid fp is the subject —
       they sit exactly on its surface there, so drawing them would just
       halo the body. The closing window has to come back BEFORE the
       cloud's own fall completes, or the last 2.5s of the loop is empty
       and the wrap cuts from nothing straight to the wordmark. Because
       win(4.15,4.85,5.85,6.45) and band(5.85,6.45) are the same ramp,
       adding them cancels exactly across the overlap: the sum is 1 from
       6.45s onward with no kink, which is just band(4.15, 4.85). */
    S.pointAlpha = Math.max(win(-0.30, -0.10, 1.10, 1.95), band(4.15, 4.85));

    S.camAlpha = body;
    S.cloud    = puff;

    /* — geometry ——————————————————————————————————————
       Multiplied by their window, so a value only matters while the
       thing it belongs to is actually drawn. */
    /* the fp converges from its exploded state, then opens again */
    S.explode  = Math.max(1 - band(1.10, 2.85), band(3.55, 5.30)) * body;

    /* — the camera move ————————————————————————————————
       One slow drift across the whole loop, built from cosines so
       value and slope match at the wrap by construction. Amplitude
       is deliberately small: the fp reads best nearly front-on, and a
       big swing turns the body three-quarters away. */
    var u = t / CYCLE;
    var drift = Math.cos(u * Math.PI * 2 - Math.PI * 0.5);
    S.tilt = 0.05 + 0.03 * Math.cos(u * Math.PI * 2);
    S.zoom = 1 + 0.028 * drift;

    /* The spin is the one parameter that cannot simply be a function of
       t, because the opening and closing beats show the wordmark with
       no camera in it — and a value chosen there is unconstrained at
       the wrap. So it is a pure cosine (value and slope both match at
       t=0 and t=CYCLE) plus one term multiplied by the camera window,
       which is identically zero at both ends of the loop. */
    S.spin = 0.15 + 0.11 * drift + 0.10 * body;
    return S;
  }

  /* Quintic smootherstep: 6t^5 - 15t^4 + 10t^3. Zero first and second
     derivative at both ends, so a ramp has no visible start or stop —
     which is the whole difference between "animated" and "mechanical". */
  function quintic(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  /* ── draw ─────────────────────────────────────────────────────── */
  Scene.prototype.draw = function (t) {
    if (!this.ok) return;
    var gl = this.gl, S = timeline(t), c = this.canvas;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(c.clientWidth * dpr));
    var h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    var aspect = w / h;
    /* The fp is normalised to a longest axis of 1.0, so the camera sits
       much closer than it did for the old 2.3-unit primitives. */
    var dist = 2.75 / S.zoom;
    perspective(this.mProj, 0.62, aspect, 0.1, 60);
    /* Eye on the +z axis, level with the model's centre. An off-axis
       eye adds a fixed downward tilt on top of S.tilt, which was
       tipping the fp onto its back and showing the top plate. */
    lookAt(this.mView, [0, 0, dist], [0, 0, 0], [0, 1, 0]);
    /* A fixed base pitch stands the fp on its feet. Without it the
       scan's own frame puts the top plate toward the viewer, because
       the exporter aimed the lens mount at +z but left the body's
       height axis lying in the screen plane. */
    var pitch = S.tilt + BASE_PITCH;
    var yaw = S.spin + BASE_YAW;
    if (this.override) { pitch = this.override.pitch; yaw = this.override.yaw; }
    rotY(this.tmpA, yaw);
    rotX(this.tmpB, pitch);
    mul(this.mModel, this.tmpA, this.tmpB);

    var su = this.uSolid, pu = this.uPoint;

    /* solid camera */
    if (S.camAlpha > 0.001) {
      gl.useProgram(this.pSolid);
      gl.bindVertexArray(this.solid.vao);
      gl.uniformMatrix4fv(su.uProj, false, this.mProj);
      gl.uniformMatrix4fv(su.uView, false, this.mView);
      gl.uniformMatrix4fv(su.uModel, false, this.mModel);
      gl.uniformMatrix4fv(su.uNormalMat, false, this.mModel);
      gl.uniform1f(su.uExplode, S.explode);
      gl.uniform1f(su.uAlpha, S.camAlpha);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.drawElements(gl.TRIANGLES, this.solid.count, gl.UNSIGNED_INT, 0);
    }

    /* point cloud */
    if (S.pointAlpha > 0.001) {
      gl.useProgram(this.pPoint);
      gl.bindVertexArray(this.points.vao);
      gl.uniformMatrix4fv(pu.uProj, false, this.mProj);
      gl.uniformMatrix4fv(pu.uView, false, this.mView);
      gl.uniformMatrix4fv(pu.uModel, false, this.mModel);
      gl.uniform1f(pu.uExplode, S.explode);
      gl.uniform1f(pu.uCloud, S.cloud);
      /* S.collapse is the delay: it reaches 1 exactly when every point
         has arrived, which is what keeps the wrap seamless. */
      gl.uniform1f(pu.uDelay, S.collapse);
      /* The wordmark is authored flat in view space, so it needs a depth.
         The fp's centre sits at view z = -dist (the eye is on +z looking at
         the origin), so -dist puts the letters at the same distance as the
         camera they came from — the dissolve between the two is then a
         pure lateral movement, with no scale jump at the crossover. */
      gl.uniform1f(pu.uLogoZ, -dist);
      gl.uniform3f(pu.uLogoCol, C.ink[0], C.ink[1], C.ink[2]);
      /* Per-point alpha. The blend is additive, so brightness and density
         are the same problem: a point's contribution accumulates with
         every neighbour that overlaps it, and once enough overlap lands
         in one pixel it clips to white and the letterforms disappear
         into a disc. So alpha has to fall as 1/N with the count, and
         uSize has to shrink with it — bigger points overlap more, which
         is the other half of the same blowout. Both are swept against
         measured framebuffer stats by tools/tune-points.js, not chosen
         by eye: the earlier 0.019/0.26 pair was 5x too big and put 4% of
         the frame at 255. */
      gl.uniform1f(pu.uAlpha, S.pointAlpha);
      /* Two alphas, because the two states are ~14x different in density:
         the cloud spreads the points over a volume, the wordmark packs
         the same count onto an inked area of ~6% of the frame. One
         shared value is either a dim cloud or a white slab. */
      gl.uniform1f(pu.uAlphaCloud, this.alphaCloud);
      gl.uniform1f(pu.uAlphaWord, this.alphaWord);
      /* Two sizes for the same reason, in reverse: the wordmark needs
         ~1px points or 150k of them fuse into a solid slab, while the
         same 1px points leave the spread cloud too sparse to see. The
         shader lerps between them by d. */
      gl.uniform1f(pu.uSizeCloud, this.sizeCloud);
      gl.uniform1f(pu.uSizeWord, this.sizeWord);
      /* The wordmark is authored 1.3 units wide in a ~1.76-unit frame.
         Scaled up so the points have more letterform to spread across —
         density per pixel is the whole ball game here. */
      gl.uniform1f(pu.uLogoScale, this.logoScale);
      gl.uniform1f(pu.uPixel, h / (2 * Math.tan(0.62 / 2)));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.drawArrays(gl.POINTS, 0, this.points.count);
    }

    gl.depthMask(true);
    gl.bindVertexArray(null);
  };

  /* ── public ───────────────────────────────────────────────────── */
  /* The scene needs the real fp mesh before it can build anything, and
     the mesh arrives over fetch, so create() is async. Callers that
     cannot await get a null scene and fall back to the flat mark. */
  /* Resolve the mesh against gl.js's OWN url, not the page's. The
     capture page, the contact sheet and the site root all sit at
     different depths, and a page-relative path breaks in two of
     them. */
  var BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/[^/]*$/, "");
    return "";
  })();

  function create(canvas, opts) {
    opts = opts || {};
    var url = opts.fpUrl || (BASE + "assets/models/sigma-fp.json");
    var wmU = opts.wmUrl || (BASE + "assets/wordmark-target.json");
    /* Both assets are needed before anything can be built: the fp is the
       cloud's origin, the wordmark is its destination. */
    return Promise.all([loadFP(url), loadWordmark(wmU)]).then(function (r) {
      return new Scene(canvas, Object.assign({}, opts,
        { fp: r[0], wm: r[1] }));
    });
  }

  window.CMPRSSR3D = {
    create: create,
    timeline: timeline,
    CYCLE: CYCLE
  };
})();
