// @ts-check

/**
 * Brand header above the scoreboard: "Home" eyebrow and the dominant
 * AACTIVATED RX neon title, with a subtle animated blue-electricity
 * effect — small bolts around the wordmark flicker at random intervals,
 * and the underline carries a slow energy sweep. Purely decorative
 * (aria-hidden effects, reduced-motion safe).
 */

import { el } from '../dom.js';
import { prefersReducedMotion } from '../shot.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * A small lightning bolt / arc glyph.
 * @param {string} d SVG path
 * @param {number} w @param {number} h
 */
function boltSvg(d, w, h) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
}

const BOLTS = [
  // jagged mini-bolts and arcs, roughly 18-30px boxes
  { cls: 'bolt-tl', d: 'M22 2 13 12l6 1-9 11 2-8-6-1z', w: 24, h: 26 },
  { cls: 'bolt-tr', d: 'M2 4c6 2 8 8 5 12s1 8 7 8', w: 18, h: 26 },
  { cls: 'bolt-bl', d: 'M16 2c-6 1-8 6-5 10s-2 8-8 8', w: 18, h: 22 },
  { cls: 'bolt-br', d: 'M2 24 11 14l-6-1 9-11-2 8 6 1z', w: 24, h: 26 },
  { cls: 'bolt-mid', d: 'M2 10c4-3 7 3 11 0s5-6 9-4', w: 24, h: 14 },
];

export class BrandHeader {
  constructor() {
    /** @type {HTMLElement[]} */
    this.bolts = BOLTS.map(({ cls, d, w, h }) => {
      const wrap = el('span', { class: `brand-bolt ${cls}`, 'aria-hidden': 'true' });
      wrap.appendChild(boltSvg(d, w, h));
      return wrap;
    });

    this.el = el(
      'header',
      { class: 'brand', role: 'banner' },
      el('p', { class: 'brand-home', text: 'Home' }),
      el(
        'div',
        { class: 'brand-mark' },
        el('h1', { class: 'brand-title', text: 'AACTIVATED RX' }),
        ...this.bolts,
      ),
      el('div', { class: 'brand-rule', 'aria-hidden': 'true' }),
    );

    if (!prefersReducedMotion()) this.scheduleZap();
  }

  /** Randomly flash one bolt every 1.3–2.8s. */
  scheduleZap() {
    const delay = 1300 + Math.random() * 1500;
    window.setTimeout(() => {
      const bolt = this.bolts[Math.floor(Math.random() * this.bolts.length)];
      bolt.classList.remove('is-zapping');
      void bolt.offsetWidth;
      bolt.classList.add('is-zapping');
      // Occasionally double-strike a second bolt for a livelier arc.
      if (Math.random() < 0.3) {
        const other = this.bolts[Math.floor(Math.random() * this.bolts.length)];
        if (other !== bolt) {
          window.setTimeout(() => {
            other.classList.remove('is-zapping');
            void other.offsetWidth;
            other.classList.add('is-zapping');
          }, 120);
        }
      }
      this.scheduleZap();
    }, delay);
  }
}
