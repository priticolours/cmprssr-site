/* ═══════════════════════════════════════════════════════════════════
   stage3d.js — runs the WebGL piece and keeps the readout honest

   The 3D animation and the counters below it are driven from ONE
   clock, so the number on screen always describes the geometry on
   screen. Two clocks would drift and the piece would start lying.

   Falls back to the flat SVG mark when WebGL2 is unavailable (older
   Safari, a locked-down browser, a machine with WebGL disabled).
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
    if (!host) return;
    var canvas = host.querySelector("[data-gl]");

    var gIn   = host.querySelector("[data-num=in]");
    var gOut  = host.querySelector("[data-num=out]");
    var gR    = host.querySelector("[data-num=ratio]");
    var gLbl  = host.querySelector("[data-label]");

    /* no canvas, or no WebGL2: the flat mark is already in the
       <noscript>, so inject it directly instead */
    function fallback() {
      if (canvas) canvas.remove();
      var f = host.querySelector(".gl-frame");
      if (f && !f.querySelector("svg")) {
        var s = document.createElement("span");
        s.setAttribute("data-mark", "full");
        s.setAttribute("data-size", "400");
        s.style.display = "block";
        s.style.width = "100%";
        s.style.padding = "8%";
        s.style.boxSizing = "border-box";
        f.appendChild(s);
        if (window.CMPRSSR) window.CMPRSSR.mountMarks();
      }
      if (gOut) gOut.textContent = GB_OUT.toFixed(1);
      if (gR) gR.textContent = RATIO;
      if (gLbl) { gLbl.textContent = "COMPRESSED"; gLbl.style.color = "#f0662f"; }
    }

    if (!canvas || !window.CMPRSSR3D) return fallback();

    var scene;
    try {
      scene = window.CMPRSSR3D.create(canvas, { count: 14000 });
    } catch (e) {
      scene = null;
    }
    if (!scene || !scene.ok) return fallback();

    /* ── the readout follows the 3D clock ─────────────────────── */
    function readout(t) {
      if (t < 1.0) {                       /* logo hold */
        if (gOut) gOut.textContent = "—";
        if (gR) gR.textContent = "—";
        if (gLbl) { gLbl.textContent = "RAW"; gLbl.style.color = "#5f7b8e"; }
        return;
      }
      if (t < 5.2) {                       /* camera: build → explode → cloud */
        if (gOut) gOut.textContent = "—";
        if (gR) gR.textContent = "—";
        if (gLbl) { gLbl.textContent = "RAW"; gLbl.style.color = "#5f7b8e"; }
        return;
      }
      /* condense: the number falls as the cloud falls into the logo */
      var c = Math.min(1, (t - 5.2) / 1.2);
      var e = 1 - Math.pow(1 - c, 3);
      if (gOut) gOut.textContent = (GB_IN + (GB_OUT - GB_IN) * e).toFixed(1);
      if (gR) gR.textContent = c > 0.6 ? RATIO : "—";
      if (gLbl) {
        gLbl.textContent = c > 0.6 ? "COMPRESSED" : "RAW";
        gLbl.style.color = c > 0.6 ? "#f0662f" : "#5f7b8e";
      }
    }

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
      var visible = true, running = false;
      var io = new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible && !running) { running = true; t0 = null; requestAnimationFrame(frame); }
        else if (!visible) running = false;
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
