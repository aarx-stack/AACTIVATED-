# AActivated Credit Repair — Website

A single-page credit repair business website in the brand colors **blue, black and white**.

## Features

- **Email opt-in popup** — appears ~2 seconds after the page loads on a visitor's first
  visit. Captures name + email with validation. Once someone opts in it never shows again;
  if they close it without opting in, it waits 24 hours before re-appearing.
- **Scheduling calendar** — interactive month calendar (Mon–Sat, past dates disabled,
  bookable up to 3 months out) with 30-minute consultation time slots and a booking form
  (name, email, phone, notes). Booked slots are marked unavailable in that visitor's browser.
- **Lead capture** — every opt-in and booking is:
  1. emailed to `contact@aactivatedrx.com` via [FormSubmit](https://formsubmit.co) (no
     backend or account needed), and
  2. saved to the browser's `localStorage` as a backup
     (`aac_optin_leads` / `aac_booking_leads`).
- Hero with animated credit-score ring, services, 3-step process, testimonials,
  CTA band, contact footer with compliance disclaimer.
- Fully responsive with a mobile hamburger menu.

## ⚠ One-time setup for lead emails

FormSubmit requires a one-time activation: the **first** form submission triggers a
confirmation email to `contact@aactivatedrx.com` — click the link inside it once, and all
future leads will be delivered automatically. Until then, leads are still kept in
`localStorage`.

## Running

No build step and no dependencies — open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
```

then visit <http://localhost:8000>.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: popup, nav, hero, services, process, results, scheduler, footer |
| `styles.css` | Blue/black/white theme, popup, calendar and responsive styles |
| `main.js` | Opt-in popup logic, calendar/slot engine, booking form, lead capture |

## Customizing

- **Lead email address** — change `LEAD_ENDPOINT` at the top of `main.js`.
- **Business hours / slots** — edit `TIME_SLOTS` in `main.js`; Sundays are closed via
  `isSelectable()`.
- **Brand colors** — edit the CSS variables at the top of `styles.css`
  (`--blue`, `--black`, `--white`).
- **Phone number** — replace the `(555) 123-4567` placeholder in `index.html`.
