/* AACTIVATED Rx landing pages — shared interactions */
(function () {
  "use strict";

  /* Hero gallery: thumbnails swap the main image */
  document.querySelectorAll("[data-gallery]").forEach(function (g) {
    var main = g.querySelector(".gallery__main img");
    var thumbs = g.querySelectorAll(".thumb");
    thumbs.forEach(function (t) {
      t.addEventListener("click", function () {
        thumbs.forEach(function (x) { x.setAttribute("aria-pressed", String(x === t)); });
        main.src = t.getAttribute("data-src");
        main.alt = t.getAttribute("data-alt") || "";
      });
    });
  });

  /* "Choose how you start": selecting an option updates the continue button */
  document.querySelectorAll("[data-options]").forEach(function (group) {
    var opts = group.querySelectorAll(".option");
    var go = document.getElementById(group.getAttribute("data-options"));
    function pick(o) {
      opts.forEach(function (x) {
        var on = x === o;
        x.setAttribute("aria-checked", String(on));
        x.tabIndex = on ? 0 : -1;
      });
      if (go) {
        go.textContent = "Continue with " + o.getAttribute("data-label");
        go.href = withAttribution(o.getAttribute("data-href"));
      }
    }
    opts.forEach(function (o, i) {
      o.addEventListener("click", function () { pick(o); });
      o.addEventListener("keydown", function (e) {
        var k = e.key, n = null;
        if (k === "ArrowRight" || k === "ArrowDown") n = opts[(i + 1) % opts.length];
        if (k === "ArrowLeft" || k === "ArrowUp") n = opts[(i - 1 + opts.length) % opts.length];
        if (n) { e.preventDefault(); pick(n); n.focus(); }
      });
    });
  });

  /* Membership tabs */
  document.querySelectorAll("[role=tablist]").forEach(function (list) {
    var tabs = list.querySelectorAll("[role=tab]");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) {
          var on = x === t;
          x.setAttribute("aria-selected", String(on));
          x.tabIndex = on ? 0 : -1;
          document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
        });
      });
    });
  });

  /* Carry affiliate / campaign params (am_id, utm_*) from this page's URL onto
     every aactivatedrx.com link so referrals are still credited at checkout. */
  var KEYS = ["am_id", "sam_id", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var here = new URLSearchParams(location.search);
  var carry = KEYS.filter(function (k) { return here.has(k); });

  function withAttribution(href) {
    if (!carry.length || !href) return href;
    try {
      var u = new URL(href, location.href);
      if (u.hostname !== "aactivatedrx.com") return href;
      carry.forEach(function (k) { if (!u.searchParams.has(k)) u.searchParams.set(k, here.get(k)); });
      return u.href;
    } catch (e) { return href; }
  }
  if (carry.length) {
    document.querySelectorAll('a[href^="https://aactivatedrx.com"]').forEach(function (a) {
      a.href = withAttribution(a.getAttribute("href"));
    });
  }
})();
