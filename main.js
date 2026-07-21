/* ============================================================
   RED DOOR STUDIOS — normal vertical scroll
   Stacked full-screen sections with reveal-on-scroll, section
   dots, a progress bar, and ambient dust.
   ============================================================ */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var panels = Array.prototype.slice.call(document.querySelectorAll("[data-panel]"));
  var dots = Array.prototype.slice.call(document.querySelectorAll(".dot"));
  var progressBar = document.getElementById("progressBar");
  var heroVideo = document.querySelector(".hero__logo");

  /* ---------------- autoplay fallback ---------------- */

  if (heroVideo) {
    heroVideo.play().catch(function () {});
    // iOS blocks autoplay in Low Power Mode — start on the first touch instead.
    var kickVideo = function () {
      window.removeEventListener("touchstart", kickVideo);
      window.removeEventListener("pointerdown", kickVideo);
      if (heroVideo.paused) heroVideo.play().catch(function () {});
    };
    window.addEventListener("touchstart", kickVideo, { passive: true });
    window.addEventListener("pointerdown", kickVideo, { passive: true });
  }

  /* ---------------- progress bar ---------------- */

  function onScroll() {
    if (!progressBar) return;
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    progressBar.style.width = ((window.scrollY / max) * 100).toFixed(2) + "%";
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------------- section tracking ---------------- */

  var activeIndex = -1;

  function setActive(i) {
    if (i === activeIndex) return;
    activeIndex = i;
    dots.forEach(function (d, k) {
      d.classList.toggle("is-active", k === i);
    });
    // Only run the hero logo video while its section is on screen
    if (heroVideo) {
      if (i === 0) {
        if (heroVideo.paused) heroVideo.play().catch(function () {});
      } else if (!heroVideo.paused) {
        heroVideo.pause();
      }
    }
  }

  var spy = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          setActive(panels.indexOf(entry.target));
        }
      });
    },
    { threshold: 0.55 }
  );
  panels.forEach(function (p) { spy.observe(p); });

  /* ---------------- reveal on scroll ---------------- */

  if (!reduceMotion) {
    var reveal = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            reveal.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.25 }
    );
    panels.forEach(function (p) {
      p.classList.add("will-reveal");
      reveal.observe(p);
    });
  }

  /* ---------------- dots navigation ---------------- */

  dots.forEach(function (d) {
    d.addEventListener("click", function () {
      var i = parseInt(d.getAttribute("data-i"), 10);
      if (panels[i]) panels[i].scrollIntoView({ behavior: "smooth" });
    });
  });

  /* ---------------- dust particles ---------------- */

  if (reduceMotion) return;

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

  window.addEventListener("resize", function () {
    resizeCanvas();
    initMotes();
  });

  resizeCanvas();
  initMotes();
  drawMotes();
})();
