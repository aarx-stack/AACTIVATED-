/* ============================================================
   RED DOOR STUDIO — 3D fly-through scroll engine
   Scrolling moves a virtual camera forward in Z; each panel
   sits deeper in space and flies past you as you scroll.
   ============================================================ */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var panels = Array.prototype.slice.call(document.querySelectorAll("[data-panel]"));
  var dots = Array.prototype.slice.call(document.querySelectorAll(".dot"));
  var progressBar = document.getElementById("progressBar");
  var heroVideo = document.querySelector(".hero__video");

  var N = panels.length;
  var DEPTH = 1100;          // z-distance between panels (px)
  var FADE_BEHIND = 260;     // how far past the camera before a panel is gone
  var PAGES_PER_PANEL = 1;   // scroll pages per panel

  document.body.style.setProperty("--pages", (N - 1) * PAGES_PER_PANEL + 1);

  /* ---------------- camera fly-through ---------------- */

  var scrollY = window.scrollY;
  var smoothY = scrollY;      // eased camera position
  var maxScroll = 1;
  var activeIndex = -1;

  function measure() {
    maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
  }

  function setActive(i) {
    if (i === activeIndex) return;
    activeIndex = i;
    dots.forEach(function (d, k) {
      d.classList.toggle("is-active", k === i);
    });
    panels.forEach(function (p, k) {
      p.classList.toggle("is-live", k === i);
    });
    // Only run the hero video while it's on screen
    if (heroVideo) {
      if (i === 0) {
        if (heroVideo.paused) heroVideo.play().catch(function () {});
      } else if (!heroVideo.paused) {
        heroVideo.pause();
      }
    }
  }

  function render() {
    var progress = smoothY / maxScroll;              // 0..1 through the site
    var camZ = progress * (N - 1) * DEPTH;           // camera depth

    for (var i = 0; i < N; i++) {
      var z = camZ - i * DEPTH;                      // panel position relative to camera
      var el = panels[i];

      // Visibility window: far ahead -> invisible, at 0 -> in focus,
      // slightly behind camera -> flies past and fades.
      var opacity, blur = 0;

      if (z > FADE_BEHIND || z < -DEPTH * 1.15) {
        opacity = 0;
      } else if (z > 0) {
        // passing the camera
        var t = z / FADE_BEHIND;
        opacity = 1 - t;
        blur = t * 14;
      } else {
        // approaching from the dark
        var a = Math.min(1, 1 + z / (DEPTH * 0.92));
        opacity = a * a;
        blur = (1 - a) * 6;
      }

      el.style.opacity = opacity.toFixed(3);
      el.style.transform = "translateZ(" + z.toFixed(1) + "px)";
      el.style.filter = blur > 0.3 ? "blur(" + blur.toFixed(1) + "px)" : "none";
      el.style.visibility = opacity <= 0.001 ? "hidden" : "visible";
    }

    if (progressBar) progressBar.style.width = (progress * 100).toFixed(2) + "%";
    setActive(Math.max(0, Math.min(N - 1, Math.round(camZ / DEPTH))));
  }

  function tick() {
    scrollY = window.scrollY;
    // ease the camera toward the real scroll position for a weighty feel
    smoothY += (scrollY - smoothY) * 0.09;
    if (Math.abs(scrollY - smoothY) < 0.05) smoothY = scrollY;
    render();
    requestAnimationFrame(tick);
  }

  /* ---------------- dust particles ---------------- */

  var canvas = document.getElementById("dust");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var motes = [];

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function initMotes() {
    motes = [];
    var count = Math.min(90, Math.floor(window.innerWidth / 14));
    for (var i = 0; i < count; i++) {
      motes.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.8 + 0.4,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -(Math.random() * 0.25 + 0.05),
        a: Math.random() * 0.5 + 0.12,
        red: Math.random() < 0.3
      });
    }
  }

  function drawMotes() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x += m.vx;
      m.y += m.vy;
      if (m.y < -5) { m.y = canvas.height + 5; m.x = Math.random() * canvas.width; }
      if (m.x < -5) m.x = canvas.width + 5;
      if (m.x > canvas.width + 5) m.x = -5;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = m.red
        ? "rgba(224,33,40," + m.a * 0.7 + ")"
        : "rgba(233,223,210," + m.a * 0.45 + ")";
      ctx.fill();
    }
    requestAnimationFrame(drawMotes);
  }

  /* ---------------- dots navigation ---------------- */

  dots.forEach(function (d) {
    d.addEventListener("click", function () {
      var i = parseInt(d.getAttribute("data-i"), 10);
      var y = (i / (N - 1)) * maxScroll;
      window.scrollTo({ top: y, behavior: "smooth" });
    });
  });

  /* ---------------- boot ---------------- */

  if (reduceMotion) {
    // CSS handles the flat stacked fallback; just wire progress + dots.
    window.addEventListener("scroll", function () {
      var p = window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight);
      if (progressBar) progressBar.style.width = (p * 100).toFixed(2) + "%";
    }, { passive: true });
    return;
  }

  measure();
  window.addEventListener("resize", function () {
    measure();
    resizeCanvas();
    initMotes();
  });
  resizeCanvas();
  initMotes();
  drawMotes();
  render();
  requestAnimationFrame(tick);
})();
