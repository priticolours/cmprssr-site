/* ═══════════════════════════════════════════════════════════════════
   mark.js — the cmprssr EXPLODED mark
   One source of truth: the same SVG is injected everywhere the mark
   appears (nav, hero, footer) and the motion layer drives it, so the
   mark can never drift between placements.

   Two forms ship:
     · full     — the whole stack with numbered leaders (>= 32px)
     · compact  — front element + sensor only, no leaders, no hairlines
                  (favicon / app icon, where the 4-part spread dies)
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* Colour values are baked per-variant so a standalone .svg file and
     the in-page mark can never drift apart. */
  var C = {
    dark: {
      ring: "#33495b",
      lens: "#cfe4ee",
      lensMid: "#a9c1d1",
      body: "#5f7b8e",
      bodyLo: "#41596b",
      signal: "#f0662f",
      leader: "#3d5566",
      label: "#7f9bad",
      axis: "#2c4354"
    },
    light: {
      ring: "#9db2c0",
      lens: "#1a2730",
      lensMid: "#33475a",
      body: "#5f7b8e",
      bodyLo: "#8ba3b3",
      signal: "#c94f1c",
      leader: "#9db2c0",
      label: "#6d8494",
      axis: "#c2d0d9"
    }
  };

  /* ── full form ────────────────────────────────────────────────
     Optical stack along the horizontal axis:
       01 front element  02 barrel  03 SENSOR  04 rear body
     Bodies, not hairlines — the 1.4px strokes of the first sketch
     disappeared at 32px. */
  function full(theme, opts) {
    opts = opts || {};
    var c = C[theme] || C.dark;
    var id = "mk" + Math.random().toString(36).slice(2, 8);
    var leaders = opts.leaders === false ? "" : leaders_(c, id);
    return (
      '<svg class="mark mark--full" viewBox="0 0 240 240" role="img" ' +
      'aria-label="cmprssr" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      "<defs>" +
      '<clipPath id="' + id + 'clip"><circle cx="120" cy="120" r="96"/></clipPath>' +
      "</defs>" +
      /* optical axis, dashed — the axis everything is exploded along */
      '<path d="M12 120 L228 120" stroke="' + c.axis + '" stroke-width="1.6" ' +
      'stroke-dasharray="2 6" stroke-linecap="round"/>' +
      /* Each stage gets its own <g> so the motion layer can slide the
         stages along the optical axis without touching geometry. */
      /* 01 · front element: outer glass + inner pupil */
      '<g class="mk-layer" data-stage="1">' +
      '<ellipse class="mk-el" cx="48" cy="120" rx="17" ry="36" stroke="' + c.lens + '" stroke-width="5.5"/>' +
      '<ellipse cx="48" cy="120" rx="8" ry="18" fill="#0d151c" stroke="' + c.body + '" stroke-width="2.4"/>' +
      "</g>" +
      /* 02 · barrel: two rings + a step */
      '<g class="mk-layer" data-stage="2">' +
      '<rect class="mk-el" x="76" y="86" width="9" height="68" rx="4.5" fill="' + c.body + '"/>' +
      '<rect class="mk-el" x="97" y="93" width="9" height="54" rx="4.5" fill="' + c.bodyLo + '"/>' +
      "</g>" +
      /* 03 · SENSOR — the only accent in the mark, and the plane the
         stages collapse toward */
      '<g class="mk-layer" data-stage="3">' +
      '<rect class="mk-sensor" x="120" y="88" width="26" height="64" rx="3" ' +
      'fill="' + c.signal + '" fill-opacity=".18" stroke="' + c.signal + '" stroke-width="4.5"/>' +
      '<path class="mk-sensor" d="M133 76 L133 164" stroke="' + c.signal + '" stroke-width="2.4" ' +
      'stroke-linecap="round"/>' +
      "</g>" +
      /* 04 · rear body: plate + connector */
      '<g class="mk-layer" data-stage="4">' +
      '<rect class="mk-el" x="162" y="94" width="16" height="52" rx="3" fill="' + c.body + '"/>' +
      '<rect class="mk-el" x="186" y="103" width="11" height="34" rx="3" fill="' + c.bodyLo + '"/>' +
      "</g>" +
      leaders +
      "</svg>"
    );
  }

  function leaders_(c, id) {
    return (
      '<g class="mk-leaders">' +
      '<path d="M48 76 L48 65" stroke="' + c.leader + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<text x="48" y="59" fill="' + c.label + '" stroke="none" font-size="10" ' +
      'text-anchor="middle" font-family="ui-monospace,Menlo,monospace">01</text>' +
      '<path d="M102 83 L102 72" stroke="' + c.leader + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<text x="102" y="66" fill="' + c.label + '" stroke="none" font-size="10" ' +
      'text-anchor="middle" font-family="ui-monospace,Menlo,monospace">02</text>' +
      '<path d="M133 164 L133 175" stroke="' + c.signal + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<text x="133" y="189" fill="' + c.signal + '" stroke="none" font-size="10" ' +
      'text-anchor="middle" font-family="ui-monospace,Menlo,monospace">03</text>' +
      '<path d="M170 84 L170 73" stroke="' + c.leader + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<text x="170" y="67" fill="' + c.label + '" stroke="none" font-size="10" ' +
      'text-anchor="middle" font-family="ui-monospace,Menlo,monospace">04</text>' +
      /* depth dimension line — this is an exploded drawing, so it gets
         the drawing's dimension line */
      '<path d="M36 212 L204 212" stroke="' + c.leader + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M36 206 L36 218 M204 206 L204 218" stroke="' + c.leader + '" stroke-width="1.6" stroke-linecap="round"/>' +
      "</g>"
    );
  }

  /* ── compact form ────────────────────────────────────────────
     Two masses on the axis, the sensor still the accent. At 16px
     the four-part spread reads as an indistinct smudge, so the icon
     form drops the barrel stages and keeps only what stays legible.

     Geometry is deliberately heavier than the full form: at 22–30px
     the full form's hairlines and thin rects turn to mud, and the
     sensor fill has to be opaque or it reads as an orange smudge
     rather than a plane. */
  function compact(theme) {
    var c = C[theme] || C.dark;
    var pupil = theme === "light" ? "#f6f6f4" : "#0d151c";
    return (
      '<svg class="mark mark--compact" viewBox="0 0 240 240" role="img" ' +
      'aria-label="cmprssr" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      /* front element: a solid glass mass with a punched pupil */
      '<ellipse cx="78" cy="120" rx="30" ry="54" fill="' + c.lensMid + '"/>' +
      '<ellipse cx="78" cy="120" rx="12" ry="22" fill="' + pupil + '"/>' +
      /* sensor: opaque accent plane, the thing the app compresses behind */
      '<rect class="mk-sensor" x="132" y="76" width="48" height="88" rx="8" fill="' + c.signal + '"/>' +
      '<rect class="mk-sensor" x="148" y="58" width="16" height="124" rx="8" fill="' + c.signal + '" opacity=".55"/>' +
      "</svg>"
    );
  }

  /* ── mount ───────────────────────────────────────────────────
     Any element carrying data-mark gets the mark. data-mark="compact"
     or data-mark="light" pick a variant. */
  function mount() {
    var nodes = document.querySelectorAll("[data-mark]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var spec = (el.getAttribute("data-mark") || "").split(/\s+/);
      var theme = spec.indexOf("light") > -1 ? "light" : "dark";
      var form = spec.indexOf("compact") > -1 ? "compact" : "full";
      var size = el.getAttribute("data-size");
      el.innerHTML = form === "compact" ? compact(theme) : full(theme, {});
      var svg = el.querySelector("svg");
      if (svg && size) {
        svg.setAttribute("width", size);
        svg.setAttribute("height", size);
      }
    }
  }

  window.CMPRSSR = window.CMPRSSR || {};
  window.CMPRSSR.mountMarks = mount;
  window.CMPRSSR.markSVG = { full: full, compact: compact };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
