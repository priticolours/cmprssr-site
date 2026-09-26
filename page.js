/* ═══════════════════════════════════════════════════════════════════
   page.js — scroll reveals + the download-state check
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ── reveal on scroll ──────────────────────────────────────── */
  function reveals() {
    var items = document.querySelectorAll(".rise");
    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < items.length; i++) items[i].classList.add("in");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add("in");
          io.unobserve(entries[i].target);
        }
      }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

    for (var j = 0; j < items.length; j++) io.observe(items[j]);
  }

  /* ── download state ──────────────────────────────────────────
     cmprssr is beta, so the button must not be a 404 waiting to
     happen. Ask the releases API once; if there is a real .app asset
     the button points straight at it, otherwise it points at the
     releases page and says so. Fails silently to the page URL. */
  function downloadState() {
    var links = document.querySelectorAll("[data-download]");
    if (!links.length) return;

    var REPO = "priticolours/cmprssr-native";
    var PAGE = "https://github.com/" + REPO + "/releases";
    var LABEL = "Download for macOS";

    fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (rel) {
        if (rel && rel.tag_name) {
          var asset = (rel.assets || []).filter(function (a) {
            return /\.dmg$|\.zip$/.test(a.name);
          })[0];
          if (asset) {
            for (var i = 0; i < links.length; i++) {
              links[i].href = asset.browser_download_url;
            }
            return;
          }
          /* Tagged release but no build yet: use the tag, keep the
             promise honest by naming what it is. */
          for (var k = 0; k < links.length; k++) {
            links[k].href = rel.html_url;
            links[k].textContent = "View " + rel.tag_name;
          }
          setNote("No build published for " + rel.tag_name + " yet — watch the repo for the first one.");
          return;
        }
        setPage();
      })
      .catch(function () { setPage(); });

    function setPage() {
      for (var i = 0; i < links.length; i++) {
        links[i].href = PAGE;
        links[i].textContent = LABEL + " → releases";
      }
    }
    function setNote(t) {
      var n = document.querySelector(".btn-note");
      if (n && !document.querySelector("[data-note-set]")) {
        n.textContent = t;
        n.setAttribute("data-note-set", "1");
      }
    }
  }

  function init() {
    reveals();
    downloadState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
