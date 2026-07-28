/* ============================================================
   MYTOTALCREDITREPAIR
   Opt-in popup · booking calendar & time slots · lead capture
   ============================================================ */

(function () {
  "use strict";

  // Leads are emailed to the business via FormSubmit (no backend needed)
  // and always saved to localStorage as a backup.
  var LEAD_ENDPOINT = "https://formsubmit.co/ajax/contact@aactivatedrx.com";

  var $ = function (id) { return document.getElementById(id); };

  function saveLead(key, lead) {
    try {
      var list = JSON.parse(localStorage.getItem(key) || "[]");
      list.push(lead);
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) { /* storage unavailable — lead still sent by email */ }
  }

  function sendLead(payload) {
    return fetch(LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () { /* offline / blocked — localStorage copy remains */ });
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE_RE = /^[+()\-.\s\d]{7,}$/;

  function setError(input, errorEl, message) {
    errorEl.textContent = message || "";
    input.classList.toggle("is-invalid", !!message);
    return !message;
  }

  /* ════════════════════════════════════════════
     1 · OPT-IN POPUP
     ════════════════════════════════════════════ */
  var overlay = $("optinOverlay");
  var OPTIN_KEY = "aac_optin_done";
  var OPTIN_DISMISS_KEY = "aac_optin_dismissed_at";
  var DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // re-show 24h after a dismissal

  function shouldShowPopup() {
    try {
      if (localStorage.getItem(OPTIN_KEY)) return false;
      var dismissed = Number(localStorage.getItem(OPTIN_DISMISS_KEY) || 0);
      return Date.now() - dismissed > DISMISS_COOLDOWN_MS;
    } catch (e) { return true; }
  }

  function openPopup() {
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var first = $("optinName");
    if (first) setTimeout(function () { first.focus(); }, 350);
  }

  function closePopup() {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    try { localStorage.setItem(OPTIN_DISMISS_KEY, String(Date.now())); } catch (e) {}
  }

  if (shouldShowPopup()) setTimeout(openPopup, 1800);

  $("optinClose").addEventListener("click", closePopup);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closePopup(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) closePopup();
  });

  $("optinForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var nameInput = $("optinName");
    var emailInput = $("optinEmail");

    var okName = setError(nameInput, $("optinNameError"),
      nameInput.value.trim().length >= 2 ? "" : "Please enter your name.");
    var okEmail = setError(emailInput, $("optinEmailError"),
      EMAIL_RE.test(emailInput.value.trim()) ? "" : "Please enter a valid email address.");
    if (!okName || !okEmail) return;

    var btn = $("optinSubmit");
    btn.disabled = true;
    btn.textContent = "Sending…";

    var lead = {
      _subject: "New opt-in lead — MyTotalCreditRepair",
      type: "Email opt-in",
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      submitted: new Date().toLocaleString()
    };
    saveLead("aac_optin_leads", lead);

    sendLead(lead).then(function () {
      try { localStorage.setItem(OPTIN_KEY, "1"); } catch (e2) {}
      $("optinForm").hidden = true;
      $("optinSuccess").hidden = false;
    });
  });

  $("optinBookBtn").addEventListener("click", function () {
    closePopup();
    var target = $("schedule");
    if (target) target.scrollIntoView({ behavior: "smooth" });
  });

  /* ════════════════════════════════════════════
     2 · NAVBAR (mobile menu)
     ════════════════════════════════════════════ */
  var burger = $("navBurger");
  var navLinks = $("navLinks");
  burger.addEventListener("click", function () {
    var open = navLinks.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
  });
  navLinks.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    }
  });

  /* ════════════════════════════════════════════
     3 · HERO SCORE ANIMATION
     ════════════════════════════════════════════ */
  (function animateScore() {
    var ring = $("scoreRing");
    var num = $("scoreNum");
    if (!ring || !num) return;
    var FROM = 300, TO = 742, MAX = 850;
    var CIRC = 326.7;
    var started = false;

    function run() {
      if (started) return;
      started = true;
      ring.style.strokeDashoffset = String(CIRC * (1 - TO / MAX));
      var t0 = null;
      function tick(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / 1600, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        num.textContent = String(Math.round(FROM + (TO - FROM) * eased));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries, obs) {
        if (entries[0].isIntersecting) { run(); obs.disconnect(); }
      }, { threshold: 0.4 }).observe(ring);
    } else {
      run();
    }
  })();

  /* ════════════════════════════════════════════
     4 · SCHEDULER — calendar, slots, booking
     ════════════════════════════════════════════ */
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var TIME_SLOTS = [
    "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM",
    "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM"
  ];
  var MAX_MONTHS_AHEAD = 3;
  var BOOKED_KEY = "aac_booked_slots"; // { "YYYY-MM-DD": ["9:00 AM", ...] }

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var viewYear = today.getFullYear();
  var viewMonth = today.getMonth();
  var selectedDate = null; // Date object
  var selectedTime = null;

  var calGrid = $("calGrid");
  var calTitle = $("calTitle");
  var slotsGrid = $("slotsGrid");
  var slotsDate = $("slotsDate");
  var summary = $("bookingSummary");

  function dateKey(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function prettyDate(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
  }

  function getBookedTimes(d) {
    try {
      var map = JSON.parse(localStorage.getItem(BOOKED_KEY) || "{}");
      return map[dateKey(d)] || [];
    } catch (e) { return []; }
  }

  function markBooked(d, time) {
    try {
      var map = JSON.parse(localStorage.getItem(BOOKED_KEY) || "{}");
      var key = dateKey(d);
      map[key] = map[key] || [];
      if (map[key].indexOf(time) === -1) map[key].push(time);
      localStorage.setItem(BOOKED_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function isSelectable(d) {
    return d >= today && d.getDay() !== 0; // no past dates, closed Sundays
  }

  function monthOffset(y, m) {
    return (y - today.getFullYear()) * 12 + (m - today.getMonth());
  }

  function renderCalendar() {
    calTitle.textContent = MONTHS[viewMonth] + " " + viewYear;
    $("calPrev").disabled = monthOffset(viewYear, viewMonth) <= 0;
    $("calNext").disabled = monthOffset(viewYear, viewMonth) >= MAX_MONTHS_AHEAD;

    calGrid.innerHTML = "";
    var firstDay = new Date(viewYear, viewMonth, 1).getDay();
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (var i = 0; i < firstDay; i++) {
      var pad = document.createElement("div");
      pad.className = "cal__day is-empty";
      calGrid.appendChild(pad);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var d = new Date(viewYear, viewMonth, day);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal__day";
      btn.textContent = String(day);
      btn.setAttribute("aria-label", prettyDate(d));

      if (d.getTime() === today.getTime()) btn.classList.add("is-today");
      if (selectedDate && d.getTime() === selectedDate.getTime()) btn.classList.add("is-selected");

      if (!isSelectable(d)) {
        btn.disabled = true;
      } else {
        (function (picked) {
          btn.addEventListener("click", function () { selectDate(picked); });
        })(d);
      }
      calGrid.appendChild(btn);
    }
  }

  function selectDate(d) {
    selectedDate = d;
    selectedTime = null;
    renderCalendar();
    renderSlots();
    updateSummary();
  }

  function renderSlots() {
    slotsGrid.innerHTML = "";
    if (!selectedDate) {
      slotsDate.textContent = "Select a date first";
      var hint = document.createElement("p");
      hint.className = "slots__empty";
      hint.textContent = "Available times will appear here once you pick a day on the calendar.";
      slotsGrid.appendChild(hint);
      return;
    }

    slotsDate.textContent = prettyDate(selectedDate);
    var booked = getBookedTimes(selectedDate);
    var anyOpen = false;

    TIME_SLOTS.forEach(function (time) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.textContent = time;
      if (booked.indexOf(time) !== -1) {
        btn.disabled = true;
        btn.setAttribute("aria-label", time + " — unavailable");
      } else {
        anyOpen = true;
        if (time === selectedTime) btn.classList.add("is-selected");
        btn.addEventListener("click", function () {
          selectedTime = time;
          renderSlots();
          updateSummary();
        });
      }
      slotsGrid.appendChild(btn);
    });

    if (!anyOpen) {
      var full = document.createElement("p");
      full.className = "slots__empty";
      full.textContent = "This day is fully booked — please pick another date.";
      slotsGrid.appendChild(full);
    }
  }

  function updateSummary() {
    if (selectedDate && selectedTime) {
      summary.textContent = "📅 " + prettyDate(selectedDate) + " at " + selectedTime;
      summary.classList.add("is-set");
    } else if (selectedDate) {
      summary.textContent = prettyDate(selectedDate) + " — now pick a time";
      summary.classList.remove("is-set");
    } else {
      summary.textContent = "No date & time selected yet";
      summary.classList.remove("is-set");
    }
  }

  $("calPrev").addEventListener("click", function () {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  $("calNext").addEventListener("click", function () {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });

  renderCalendar();
  renderSlots();
  updateSummary();

  /* Booking form */
  $("bookingForm").addEventListener("submit", function (e) {
    e.preventDefault();

    var nameInput = $("bookName");
    var emailInput = $("bookEmail");
    var phoneInput = $("bookPhone");

    var okName = setError(nameInput, $("bookNameError"),
      nameInput.value.trim().length >= 2 ? "" : "Please enter your name.");
    var okEmail = setError(emailInput, $("bookEmailError"),
      EMAIL_RE.test(emailInput.value.trim()) ? "" : "Please enter a valid email address.");
    var okPhone = setError(phoneInput, $("bookPhoneError"),
      PHONE_RE.test(phoneInput.value.trim()) ? "" : "Please enter a valid phone number.");

    if (!selectedDate || !selectedTime) {
      summary.textContent = "⚠ Please choose a date and time above first";
      summary.classList.remove("is-set");
      $("schedule").scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (!okName || !okEmail || !okPhone) return;

    var btn = $("bookSubmit");
    btn.disabled = true;
    btn.textContent = "Booking…";

    var when = prettyDate(selectedDate) + " at " + selectedTime;
    var lead = {
      _subject: "New consultation booking — MyTotalCreditRepair",
      type: "Consultation booking",
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      phone: phoneInput.value.trim(),
      appointment: when,
      notes: $("bookNotes").value.trim(),
      submitted: new Date().toLocaleString()
    };
    saveLead("aac_booking_leads", lead);
    markBooked(selectedDate, selectedTime);

    sendLead(lead).then(function () {
      $("bookingForm").hidden = true;
      $("bookingSuccessText").textContent =
        "Your free consultation is set for " + when +
        ". We'll email " + lead.email + " to confirm.";
      $("bookingSuccess").hidden = false;
    });
  });

  $("bookAnother").addEventListener("click", function () {
    selectedDate = null;
    selectedTime = null;
    var form = $("bookingForm");
    form.reset();
    form.hidden = false;
    $("bookingSuccess").hidden = true;
    var btn = $("bookSubmit");
    btn.disabled = false;
    btn.textContent = "Confirm My Consultation";
    renderCalendar();
    renderSlots();
    updateSummary();
  });

})();
