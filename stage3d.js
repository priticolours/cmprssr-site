/* ═══════════════════════════════════════════════════════════════════
   stage3d.js — runs the WebGL piece and keeps the readout honest

   The 3D animation and the counters below it are driven from ONE
   clock, so the number on screen always describes the geometry on
   screen. Two clocks would drift and the piece would start lying.

   Falls back to the flat SVG mark when WebGL2 is unavailable (older
   Safari, a locked-down browser, a machine with WebGL disabled) or
   when the fp mesh fails to load.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var CYCLE = 7.0;
  var GB_IN = 38.2;
  var GB_OUT = 23.2;                 /* 38.2 / 1.65, the default tier */
  var RATIO = "1.65 : 1";

  var reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function init() {
    var host = document.querySelector("[data-stage3d]");
    if (host) runHero(host);
    var stage = document.querySelector("[data-fp-diagram]");
    if (stage) runDiagram(stage);
  }

  /* ── the readout, shared by the hero ─────────────────────────
     The same function drives the counters, so the numbers in the
     page and the geometry in the canvas can never disagree. */
  function makeReadout(host) {
    var gIn  = host.querySelector("[data-num=in]");
    var gOut = host.querySelector("[data-num=out]");
    var gR   = host.querySelector("[data-num=ratio]");
    var gLbl = host.querySelector("[data-label]");

    return function (t) {
      if (t < 5.2) {                          /* logo -> fp -> cloud */
        if (gIn)  gIn.textContent  = GB_IN.toFixed(1);
        if (gOut) gOut.textContent = "—";
        if (gR)   gR.textContent   = "—";
        if (gLbl) { gLbl.textContent = "RAW"; gLbl.style.color = "#5f7b8e"; }
        return;
      }
      /* condense: the number falls as the cloud falls into the logo */
      var c = Math.min(1, (t - 5.2) / 1.2);
      var e = 1 - Math.pow(1 - c, 3);
      if (gIn)  gIn.textContent  = GB_IN.toFixed(1);
      if (gOut) gOut.textContent = (GB_IN + (GB_OUT - GB_IN) * e).toFixed(1);
      if (gR)   gR.textContent   = c > 0.6 ? RATIO : "—";
      if (gLbl) {
        gLbl.textContent = c > 0.6 ? "COMPRESSED" : "RAW";
        gLbl.style.color = c > 0.6 ? "#f0662f" : "#5f7b8e";
      }
    };
  }

  /* ── the flat-mark fallback ──────────────────────────────────
     A failed WebGL context should cost the page a picture, not a
     hole, so the SVG mark is injected in the space the canvas
     would have filled. */
  function flatMark(host, size) {
    var f = host.querySelector(".gl-frame") || host;
    if (f.querySelector("svg")) return;
    var s = document.createElement("span");
    s.setAttribute("data-mark", "full");
    s.setAttribute("data-size", String(size));
    s.style.display = "block";
    s.style.width = "100%";
    s.style.padding = "10%";
    s.style.boxSizing = "border-box";
    f.appendChild(s);
    if (window.CMPRSSR && window.CMPRSSR.mountMarks) {
      window.CMPRSSR.mountMarks();
    }
  }

  /* ── the hero ──────────────────────────────────────────────── */
  function runHero(host) {
    var canvas = host.querySelector("[data-gl]");
    var readout = makeReadout(host);

    function fail() {
      if (canvas) canvas.remove();
      flatMark(host, 400);
      readout(6.6);
    }

    if (!canvas || !window.CMPRSSR3D) return fail();

    /* create() is async: the real fp mesh is fetched before the scene
       can be built. Everything downstream waits on it, and any failure
       drops to the flat mark rather than leaving an empty canvas. */
    window.CMPRSSR3D.create(canvas, { count: 15000 })
      .then(function (scene) {
        if (!scene || !scene.ok) return fail();
        start(scene, host, readout);
      })
      .catch(fail);
  }

  /* ── the mid-page figure: the same fp, held exploded ─────────
     This is the object the point cloud comes from and the logo it
     condenses into, so it is the SAME scene held at one frame
     rather than a separate render. That makes the page's claim
     literally true instead of nearly true. */
  function runDiagram(stage) {
    var canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label",
      "The Sigma fp, exploded along its optical axis into five stages");
    stage.appendChild(canvas);

    if (!window.CMPRSSR3D) {
      stage.setAttribute("data-fallback", "");
      return;
    }

    window.CMPRSSR3D.create(canvas, { count: 15000, static: true })
      .then(function (scene) {
        if (!scene || !scene.ok) {
          stage.setAttribute("data-fallback", "");
          return;
        }
        /* t=3.35 is the fully exploded pose, held. */
        scene.draw(3.35);
        /* the section may have been zero-height when the canvas was
           first sized, so draw again once layout has settled */
        setTimeout(function () { scene.draw(3.35); }, 80);
      })
      .catch(function () { stage.setAttribute("data-fallback", ""); });
  }

  function start(scene, host, readout) {
    if (reduced) {
      /* Hold the logo: the piece has already arrived, and asking a
         motion-sensitive viewer to sit through the journey is the
         whole thing reduced-motion is for. */
      scene.draw(6.6);
      readout(6.6);
      return;
    }

    var t0 = null;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var t = ((ts - t0) / 1000) % CYCLE;
      scene.draw(t);
      readout(t);
      requestAnimationFrame(frame);
    }

    /* only animate while visible — a background tab should not spin
       the GPU for nothing */
    if ("IntersectionObserver" in window) {
      var running = false;
      var io = new IntersectionObserver(function (es) {
        var vis = es[0].isIntersecting;
        if (vis && !running) { running = true; t0 = null; requestAnimationFrame(frame); }
        else if (!vis) running = false;
      }, { threshold: 0.05 });
      io.observe(host);
    } else {
      requestAnimationFrame(frame);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
