/* ═══════════════════════════════════════════════════════════════════
   gl.js — the cmprssr 3D motion graphic

   Raw WebGL2, no libraries. One animation, 7 seconds, seamless loop:

     0.0 – 1.0   LOGO        two rectangles hold
     1.0 – 2.0   BUILD       the fp converges from its exploded state
     2.0 – 2.8   ASSEMBLED   the fp turns
     2.8 – 4.0   EXPLODE     the real body separates along its optical axis
     4.0 – 4.4   DISSOLVE    the fp becomes a point cloud
     4.4 – 5.2   CLOUD       the cloud holds
     5.2 – 6.4   CONDENSE    the cloud contracts into the logo
     6.4 – 7.0   LOGO        hold — matches t=0, so the loop is seamless

   The camera is the real Sigma fp, from the scan in
   DUMP/fp model, sliced into five stages along its own optical axis
   (see tools/stl-to-blob.py). It is not a stand-in.

   Why no library: the whole thing is one vertex shader that lerps a
   point between three positions — on the mesh, scattered in the cloud,
   and on the logo. Three.js would be 600KB to do arithmetic I can do
   in 40 lines, and the page has no external requests by design.

   Every point knows all three of its homes, so the morph is exact:
   the cloud at t=5.2s lands precisely on the logo surface and the
   handoff to solid geometry is invisible.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var CYCLE = 7.0;

  var C = {
    lens:  [0.81, 0.89, 0.93],
    steel: [0.50, 0.61, 0.68],
    body:  [0.30, 0.40, 0.48],
    bodyLo:[0.20, 0.28, 0.35],
    signal:[0.94, 0.40, 0.18]
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
  function logoMesh() {
    var a = box(0.30, 1.44, 0.16);
    var b = box(0.46, 1.44, 0.16);
    var p = [], n = [], idx = [];
    function push(m, dx, col) {
      var base = p.length/3;
      for (var i = 0; i < m.pos.length; i += 3) {
        p.push(m.pos[i]+dx, m.pos[i+1], m.pos[i+2]);
        n.push(m.nrm[i], m.nrm[i+1], m.nrm[i+2]);
      }
      for (var k = 0; k < m.idx.length; k++) idx.push(m.idx[k] + base);
    }
    push(a, -0.46, 0);
    push(b,  0.40, 1);
    return {
      mesh: { pos:p, nrm:n, idx:idx },
      /* part id 0 = left rect, 1 = right rect, for point targets */
      groups: [{ base:0, count:a.pos.length/3, color:C.lens },
               { base:a.pos.length/3, count:b.pos.length/3, color:C.signal }]
    };
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
  var POS_CHUNK = [
    "vec3 place(vec3 aPos, vec3 aDir, float aDist, vec3 aScatter, vec3 aLogo,",
    "            float uExplode, float uCloud, float uCollapse) {",
    "  vec3 pEx = aPos + aDir * aDist * uExplode;",
    "  vec3 pSc = mix(pEx, pEx + aScatter, uCloud);",
    "  return mix(pSc, aLogo, uCollapse);",
    "}"
  ].join("\n");

  var VS_SOLID = [
    "#version 300 es",
    "in vec3 aPos; in vec3 aNrm; in vec3 aCol;",
    "in vec3 aDir; in float aDist; in vec3 aLogo;",
    "uniform mat4 uProj, uView, uModel, uNormalMat;",
    "uniform float uExplode, uCloud, uCollapse, uAlpha;",
    "out vec3 vNrm; out vec3 vCol; out float vAlpha; out vec3 vView;",
    POS_CHUNK,
    "void main() {",
    "  vec3 p = place(aPos, aDir, aDist, vec3(0.0), aLogo, uExplode, uCloud, uCollapse);",
    "  vec4 world = uModel * vec4(p, 1.0);",
    "  vView = world.xyz;",
    "  vNrm = normalize(mat3(uModel) * aNrm);",
    "  vCol = aCol; vAlpha = uAlpha;",
    "  gl_Position = uProj * uView * world;",
    "}"
  ].join("\n");

  var FS_SOLID = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vNrm; in vec3 vCol; in float vAlpha; in vec3 vView;",
    "uniform float uAlpha;",
    "out vec4 o;",
    "void main() {",
    "  vec3 N = normalize(vNrm);",
    "  vec3 L = normalize(vec3(0.45, 0.75, 0.62));",
    "  float d = max(dot(N, L), 0.0);",
    "  vec3 V = normalize(-vView);",
    "  vec3 H = normalize(L + V);",
    "  float sp = pow(max(dot(N, H), 0.0), 42.0) * 0.55;",
    "  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6) * 0.30;",
    "  vec3 c = vCol * (0.24 + 0.72 * d) + vec3(sp) + vCol * rim;",
    "  o = vec4(c, uAlpha);",
    "}"
  ].join("\n");

  var VS_POINT = [
    "#version 300 es",
    "in vec3 aPos; in vec3 aCol;",
    "in vec3 aDir; in float aDist; in vec3 aScatter; in vec3 aLogo;",
    "uniform mat4 uProj, uView, uModel;",
    "uniform float uExplode, uCloud, uCollapse, uAlpha, uSize, uPixel;",
    "out vec3 vCol; out float vAlpha;",
    POS_CHUNK,
    "void main() {",
    "  vec3 p = place(aPos, aDir, aDist, aScatter, aLogo, uExplode, uCloud, uCollapse);",
    "  vec4 world = uModel * vec4(p, 1.0);",
    "  vec4 vp = uView * world;",
    "  gl_Position = uProj * vp;",
    "  gl_PointSize = clamp(uSize * uPixel / max(-vp.z, 0.05), 1.0, 64.0);",
    "  vCol = aCol;",
    "  vAlpha = uAlpha;",
    "}"
  ].join("\n");

  var FS_POINT = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vCol; in float vAlpha;",
    "uniform float uAlpha;",
    "out vec4 o;",
    "void main() {",
    "  vec2 d = gl_PointCoord - 0.5;",
    "  float r = dot(d, d);",
    "  if (r > 0.25) discard;",
    "  float a = smoothstep(0.25, 0.02, r);",
    "  o = vec4(vCol, a * uAlpha);",
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
    this.count = opts.count || 14000;
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

    this.uSolid = locs(gl, this.pSolid, ["uProj","uView","uModel","uNormalMat",
      "uExplode","uCloud","uCollapse","uAlpha"]);
    this.uPoint = locs(gl, this.pPoint, ["uProj","uView","uModel",
      "uExplode","uCloud","uCollapse","uAlpha","uSize","uPixel"]);

    var rnd = rng(0x5eed1a);
    this.rnd = rnd;
    var fp = opts.fp;
    if (!fp) return;                 /* no geometry, no scene */

    /* The real fp becomes five exploded stages along its own optical
       axis. Each stage is a slice of the scan, so the "explode" is a
       real teardown of the real body. */
    var st = fpStages(fp);
    var parts = fpParts(fp, st);
    var logo = logoMesh();

    this._buildSolid(parts, logo);
    this._buildPoints(parts, logo, rnd);

    this.mProj = m4(); this.mView = m4(); this.mModel = m4();
    this.tmpA = m4(); this.tmpB = m4();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(this.clear[0], this.clear[1], this.clear[2], this.clear[3]);
    this.ok = true;
  }

  /* Solid geometry: camera parts + logo, each vertex carrying where it
     belongs in the explode and on the logo. */
  Scene.prototype._buildSolid = function (parts, logo) {
    var gl = this.gl, V = 0, I = 0, k;
    for (k = 0; k < parts.length; k++) {
      V += parts[k].mesh.pos.length/3; I += parts[k].mesh.idx.length;
    }
    V += logo.mesh.pos.length/3; I += logo.mesh.idx.length;

    var pos = new Float32Array(V*3), nrm = new Float32Array(V*3),
        col = new Float32Array(V*3), dir = new Float32Array(V),
        dst = new Float32Array(V), lgo = new Float32Array(V*3),
        idx = new Uint32Array(I);

    var vo = 0, io = 0, i;
    function emit(mesh, px, d, dist, color, logoPts, logoBase) {
      var n = mesh.pos.length/3, base = vo;
      for (i = 0; i < n; i++) {
        pos[(base+i)*3]   = mesh.pos[i*3]   + px;
        pos[(base+i)*3+1] = mesh.pos[i*3+1];
        pos[(base+i)*3+2] = mesh.pos[i*3+2];
        nrm[(base+i)*3]   = mesh.nrm[i*3];
        nrm[(base+i)*3+1] = mesh.nrm[i*3+1];
        nrm[(base+i)*3+2] = mesh.nrm[i*3+2];
        col[(base+i)*3]   = color[0];
        col[(base+i)*3+1] = color[1];
        col[(base+i)*3+2] = color[2];
        dir[base+i] = d;
        dst[base+i] = dist;
        /* default logo target = own position, so a part that never
           collapses simply sits where it is */
        lgo[(base+i)*3]   = mesh.pos[i*3]   + px;
        lgo[(base+i)*3+1] = mesh.pos[i*3+1];
        lgo[(base+i)*3+2] = mesh.pos[i*3+2];
      }
      for (i = 0; i < mesh.idx.length; i++) idx[io++] = mesh.idx[i] + base;
      vo += n;
    }

    for (k = 0; k < parts.length; k++) {
      emit(parts[k].mesh, parts[k].x, parts[k].dir, parts[k].dist, parts[k].color);
    }
    var camEnd = vo;
    emit(logo.mesh, 0, 0, 0, C.lens);

    /* Paint the logo's two rectangles their real colours, and give
       every camera vertex a target on the logo so the collapse is
       a real redistribution rather than everyone piling on one point. */
    for (k = 0; k < logo.groups.length; k++) {
      var g = logo.groups[k], c = g.color;
      for (i = 0; i < g.count; i++) {
        var v = camEnd + g.base + i;
        col[v*3] = c[0]; col[v*3+1] = c[1]; col[v*3+2] = c[2];
      }
    }
    var logoPts = sampleSurface(logo.mesh, camEnd, this.rnd);
    for (i = 0; i < camEnd; i++) {
      lgo[i*3]   = logoPts[i*3];
      lgo[i*3+1] = logoPts[i*3+1];
      lgo[i*3+2] = logoPts[i*3+2];
    }

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    function buf(name, data, size) {
      var loc = gl.getAttribLocation(this.pSolid, name);
      if (loc < 0) return;
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    var self = this;
    [["aPos",pos,3], ["aNrm",nrm,3], ["aCol",col,3],
     ["aDir",new Float32Array(dir),1], ["aDist",new Float32Array(dst),1],
     ["aLogo",lgo,3]].forEach(function (a) { buf.call(self, a[0], a[1], a[2]); });

    var ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.solid = { vao:vao, count:idx.length, camCount:0, total:I };
    this.solid.camIndices = 0;
    /* draw ranges: camera first, then logo */
    var camI = 0;
    for (k = 0; k < parts.length; k++) camI += parts[k].mesh.idx.length;
    this.solid.camCount = camI;
    this.solid.logoStart = camI;
  };

  /* The cloud: one point per sample, each knowing its mesh home, a
     scatter target, and a spot on the logo. */
  /* Point count is a function of surface area, not a fixed number: the
     fp is 1.0 long where the old primitives were 2.3, so the same count
     is roughly 5x denser per unit area. */
  Scene.prototype._buildPoints = function (parts, logo, rnd) {
    var gl = this.gl;
    var total = this.count;
    var pos = new Float32Array(total*3), col = new Float32Array(total*3),
        dir = new Float32Array(total), dst = new Float32Array(total),
        sca = new Float32Array(total*3), lgo = new Float32Array(total*3);

    var logoPts = sampleSurface(logo.mesh, total, rnd);

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

    var o = 0;
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
        /* Scatter is deliberately TIGHT. A wide scatter turns 14k
           points into generic starfield and the camera's silhouette is
           lost — the cloud has to still read as *this* camera, so the
           points stay close to where they were sampled and gain only
           enough jitter to look granular. */
        var th = rnd()*Math.PI*2, ph = Math.acos(2*rnd()-1);
        var edge = (k===0||k===4) ? 1.0 : 0.82;
        var rr = (0.30 + 0.78*Math.pow(rnd(), 0.55)) * edge;
        sca[v*3]   = Math.sin(ph)*Math.cos(th)*rr;
        sca[v*3+1] = Math.cos(ph)*rr*0.72;
        sca[v*3+2] = Math.sin(ph)*Math.sin(th)*rr;
        lgo[v*3]   = logoPts[v*3];
        lgo[v*3+1] = logoPts[v*3+1];
        lgo[v*3+2] = logoPts[v*3+2];
      }
      o += n;
    }

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    function buf(name, data, size) {
      var loc = gl.getAttribLocation(this.pPoint, name);
      if (loc < 0) return;
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    var self = this;
    ["aPos","aCol","aDir","aDist","aScatter","aLogo"].forEach(function (nm) {
      var map = { aPos:pos, aCol:col, aDir:dir, aDist:dst, aScatter:sca, aLogo:lgo };
      var size = nm === "aDir" || nm === "aDist" ? 1 : 3;
      buf.call(self, nm, new Float32Array(map[nm]), size);
    });
    gl.bindVertexArray(null);
    this.points = { vao:vao, count:total };
  };

  /* ── timeline ─────────────────────────────────────────────────
     Everything the render needs, derived from t alone. */
  function timeline(t) {
    t = ((t % CYCLE) + CYCLE) % CYCLE;
    var S = { explode:0, cloud:0, collapse:0,
              camAlpha:0, logoAlpha:0, pointAlpha:0,
              spin:0, tilt:0, zoom:1 };

    /* The spin/tilt curve is continuous across every phase boundary.
       t=0 and t=CYCLE hold identical values, so the loop has no seam.
       Anchors: 0.30 → 0.12 → 0.18 → 0.52 → 0.68 → 0.72 → 0.30. */
    if (t < 1.0) {                                   /* LOGO */
      S.logoAlpha = 1;
      S.spin = 0.30; S.tilt = 0.0;
    } else if (t < 2.0) {                            /* BUILD */
      var b = ease(Math.min(1, (t - 1.0) / 1.25));
      S.logoAlpha = Math.max(0, 1 - (t - 1.0) * 3.2);
      S.camAlpha = Math.min(1, (t - 1.0) * 3.2);
      S.explode = 1 - b;
      S.spin = 0.30 + (0.12 - 0.30) * b;
      S.tilt = 0.0 + (0.10 - 0.0) * b;
    } else if (t < 2.8) {                            /* ASSEMBLED */
      S.camAlpha = 1;
      S.spin = 0.12 + (0.18 - 0.12) * ((t - 2.0) / 0.8);
      S.tilt = 0.10;
    } else if (t < 4.0) {                            /* EXPLODE */
      var e = ease((t - 2.8) / 1.2);
      var er = (t - 2.8) / 1.2;
      S.camAlpha = 1 - Math.max(0, (er - 0.82) / 0.18);
      S.explode = e;
      /* Spin stays shallow: the fp's most legible view is its front
         (lens mount), which faces the viewer at spin 0. Any larger
         swing turns the body three-quarters away and the silhouette
         stops reading as a camera. */
      S.spin = 0.18 + (0.34 - 0.18) * e;
      S.tilt = 0.10 + (0.05 - 0.10) * e;
    } else if (t < 4.4) {                            /* DISSOLVE */
      var d = ease((t - 4.0) / 0.4);
      S.explode = 1;
      S.cloud = d;
      S.camAlpha = 1 - d;
      S.pointAlpha = d;
      S.spin = 0.34 + (0.50 - 0.34) * d;
      S.tilt = 0.05;
    } else if (t < 5.2) {                            /* CLOUD */
      S.explode = 1; S.cloud = 1; S.pointAlpha = 1;
      S.spin = 0.50 + (0.52 - 0.50) * ((t - 4.4) / 0.8);
      S.tilt = 0.05;
    } else if (t < 6.4) {                            /* CONDENSE */
      var cr = (t - 5.2) / 1.2;
      var c = ease(cr);
      S.explode = 1; S.cloud = 1;
      S.collapse = c;
      S.pointAlpha = cr > 0.82 ? 1 - (cr - 0.82) / 0.18 : 1;
      S.logoAlpha = cr > 0.78 ? (cr - 0.78) / 0.22 : 0;
      S.spin = 0.72 + (0.30 - 0.72) * c;
      S.tilt = 0.05 + (0.0 - 0.05) * c;
    } else {                                         /* LOGO hold */
      S.collapse = 1; S.cloud = 1; S.explode = 1;
      S.logoAlpha = 1;
      S.spin = 0.30; S.tilt = 0.0;
    }
    return S;
  }

  function ease(x) {
    x = Math.max(0, Math.min(1, x));
    return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2, 3)/2;
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
      gl.uniform1f(su.uCloud, 0);
      gl.uniform1f(su.uCollapse, 0);
      gl.uniform1f(su.uAlpha, S.camAlpha);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.drawElements(gl.TRIANGLES, this.solid.camCount, gl.UNSIGNED_INT, 0);
    }

    /* logo */
    if (S.logoAlpha > 0.001) {
      if (S.camAlpha <= 0.001) {
        gl.useProgram(this.pSolid);
        gl.bindVertexArray(this.solid.vao);
        gl.uniformMatrix4fv(su.uProj, false, this.mProj);
        gl.uniformMatrix4fv(su.uView, false, this.mView);
        gl.uniformMatrix4fv(su.uModel, false, this.mModel);
        gl.uniformMatrix4fv(su.uNormalMat, false, this.mModel);
        gl.uniform1f(su.uExplode, 0);
        gl.uniform1f(su.uCloud, 0);
        gl.uniform1f(su.uCollapse, 0);
        gl.uniform1f(su.uAlpha, 1);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(true);
      }
      gl.uniform1f(su.uAlpha, S.logoAlpha);
      gl.drawElements(gl.TRIANGLES,
        this.solid.count - this.solid.logoStart, gl.UNSIGNED_INT,
        this.solid.logoStart * 4);
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
      gl.uniform1f(pu.uCollapse, S.collapse);
      /* Alpha is per-point and the points are additive, so density
         and brightness are the same problem. 26k points on a 1.0-long
         fp are ~6x denser per unit area than 14k were on the old
         2.3-unit primitives, which clips to a white disc. */
      gl.uniform1f(pu.uAlpha, S.pointAlpha * 0.26);
      /* uSize is a world-space diameter, uPixel is pixels per world unit
         at unit depth, so the shader's single divide yields a real pixel
         size that shrinks with distance. 0.02 world units at the cloud's
         ~4.3 unit distance renders as a ~2.5px point. The upper clamp
         in the shader is what stops a near-camera particle from becoming
         a full-screen disc. */
      gl.uniform1f(pu.uSize, 0.026);
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
    return loadFP(url).then(function (fp) {
      return new Scene(canvas, Object.assign({}, opts, { fp: fp }));
    });
  }

  window.CMPRSSR3D = {
    create: create,
    timeline: timeline,
    CYCLE: CYCLE
  };
})();
