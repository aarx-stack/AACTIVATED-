# Red Door Studio — 3D Scrolling Website

A single-page 3D "fly-through" scrolling site built around the Red Door Studio artwork.
Scrolling moves a virtual camera forward through z-space: each section starts deep in the
dark, flies toward you into focus, then blurs past the camera as the next one approaches.

## Features

- **3D fly-through scroll** — panels positioned in real CSS 3D space (`perspective` +
  `translateZ`), driven by an eased camera that follows the scrollbar
- **Mouse-parallax hero** — the poster tilts in 3D and catches a light sheen as the
  pointer moves
- **Atmosphere** — canvas-rendered floating dust motes, animated film grain, and a vignette
- **Navigation** — scroll progress bar and clickable section dots
- **Accessible fallback** — `prefers-reduced-motion` collapses the scene into a flat,
  normally-scrolling page

## Running

No build step and no dependencies — open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
```

then visit <http://localhost:8000>.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and all six panels |
| `styles.css` | Theme, panel styling, overlays, reduced-motion fallback |
| `main.js` | Camera fly-through engine, hero tilt, dust particles, dots/progress |
| `assets/red-door-studio.png` | Source artwork |

## Tapfiliate affiliate tier webhook

`api/tapfiliate-webhook.js` is a Vercel serverless function that receives
Tapfiliate **Conversion created** webhooks and automatically moves affiliates
between the AACTIVATED RX commission tiers (Standard 15% → Elite 35%) based on
their current-month qualifying sales, while never touching the protected B2B
groups. It ships with `DRY_RUN=true` by default.

Full setup, environment variables, and safety rules:
[`docs/tapfiliate-tier-webhook.md`](docs/tapfiliate-tier-webhook.md).

```sh
npm test   # run the webhook's test suite (no network needed)
```
