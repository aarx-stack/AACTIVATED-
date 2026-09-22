// @ts-check

/**
 * The basketball hoop that lives inside the scoreboard: glass backboard,
 * orange rim and a net drawn in two SVG layers (back strands / front
 * strands) with a drop-ball element sandwiched between them, so the made
 * ball visibly falls *through* the net. Registers itself with the
 * ShotDirector as the shot target.
 */

import { el, basketballSvg } from '../dom.js';
import { shotDirector } from '../shot.js';

const NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 120;
const VIEW_H = 128;
const RIM_Y = 64;

/**
 * @param {string} className
 * @param {string} inner
 */
function svgLayer(className, inner) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = inner;
  return svg;
}

/**
 * Net lattice: strands from the rim tapering down, split back/front.
 * @param {boolean} front
 */
function netPaths(front) {
  // Anchor points along the rim ellipse (x across 43..77) down to a narrower
  // mouth at the bottom (x across 50..70).
  const top = front ? [46, 53, 60, 67, 74] : [43, 51.5, 60, 68.5, 77];
  const bottomSpread = front ? 9 : 12;
  const segs = [];
  for (let i = 0; i < top.length; i++) {
    const tx = top[i];
    const bx = 60 + ((tx - 60) / 17) * bottomSpread;
    const midx = 60 + ((tx - 60) / 17) * (bottomSpread + 4.5);
    segs.push(`M${tx} ${RIM_Y + 1.5} L${midx} ${RIM_Y + 16} L${bx} ${RIM_Y + 30}`);
  }
  // Cross threads.
  segs.push(
    `M${front ? 46.7 : 44.4} ${RIM_Y + 6} Q60 ${RIM_Y + 11} ${front ? 73.3 : 75.6} ${RIM_Y + 6}`,
    `M${front ? 48.8 : 47.3} ${RIM_Y + 16} Q60 ${RIM_Y + 21} ${front ? 71.2 : 72.7} ${RIM_Y + 16}`,
    `M${front ? 50.6 : 49.8} ${RIM_Y + 25} Q60 ${RIM_Y + 29} ${front ? 69.4 : 70.2} ${RIM_Y + 25}`,
  );
  return segs.map((d) => `<path d="${d}"/>`).join('');
}

export class HoopStage {
  constructor() {
    /** @type {number | undefined} */
    this.makeTimer = undefined;

    const back = svgLayer(
      'hoop-svg hoop-back',
      `
      <line x1="60" y1="0" x2="60" y2="12" class="hoop-mount"/>
      <rect x="20" y="12" width="80" height="50" rx="5" class="hoop-board"/>
      <rect x="46" y="36" width="28" height="21" rx="2" class="hoop-target"/>
      <rect x="55" y="57" width="10" height="7" rx="1.5" class="hoop-bracket"/>
      <path d="M43 ${RIM_Y} A17 4.6 0 0 1 77 ${RIM_Y}" class="hoop-rim-back"/>
      <g class="hoop-net net-back">${netPaths(false)}</g>
    `,
    );

    this.dropBall = el('div', { class: 'stage-dropball', 'aria-hidden': 'true' }, basketballSvg(30));

    const front = svgLayer(
      'hoop-svg hoop-front',
      `
      <g class="hoop-net net-front">${netPaths(true)}</g>
      <path d="M43 ${RIM_Y} A17 4.6 0 0 0 77 ${RIM_Y}" class="hoop-rim-front"/>
    `,
    );

    // Invisible anchor at the rim mouth — the shot director flies the ball
    // to this exact point, whatever size/position the stage renders at.
    this.rimAnchor = el('span', { class: 'rim-anchor', 'aria-hidden': 'true' });

    this.el = el(
      'div',
      { class: 'sb-stage', 'aria-hidden': 'true' },
      el('div', { class: 'stage-hoop' }, back, this.dropBall, front, this.rimAnchor),
      el('div', { class: 'stage-swish', text: 'SWISH' }),
      el(
        'div',
        { class: 'stage-caption' },
        basketballSvg(11),
        el('span', { text: 'SCORE TRACKER' }),
        basketballSvg(11),
      ),
    );

    shotDirector.registerStage(this);
  }

  /** Rim mouth in client coordinates, or null if not renderable. */
  rimPoint() {
    if (!this.el.isConnected) return null;
    const r = this.rimAnchor.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Net snap + ball dropping through + SWISH flicker. Purely cosmetic. */
  playMake() {
    window.clearTimeout(this.makeTimer);
    this.el.classList.remove('is-make');
    // Restart CSS animations cleanly even on back-to-back makes.
    void this.el.offsetWidth;
    this.el.classList.add('is-make');
    this.makeTimer = window.setTimeout(() => this.el.classList.remove('is-make'), 950);
  }
}
