// @ts-check

/**
 * One player's panel on the arena scoreboard: initials, a big LED score
 * with ghost segments, an odometer-style roll when the value changes, and
 * a floating "+1" chip on a made shot.
 */

import { el } from '../dom.js';

export class ScoreboardPlayer {
  /** @param {{ initials: string, name: string }} player */
  constructor(player) {
    this.player = player;
    this.value = 0;
    /** @type {number | undefined} */
    this.rollTimer = undefined;
    /** @type {number | undefined} */
    this.flashTimer = undefined;
    /** @type {number | undefined} */
    this.plusTimer = undefined;

    this.ghostEl = el('span', { class: 'score-ghost led', 'aria-hidden': 'true', text: '88' });
    this.rollEl = el('span', { class: 'score-roll led', text: '0' });
    this.plusEl = el('span', { class: 'plus-chip', 'aria-hidden': 'true', text: '+1' });

    this.el = el(
      'div',
      {
        class: 'sb-player',
        role: 'group',
        'aria-label': `${player.initials} — 0 completed tasks`,
      },
      el('span', { class: 'sb-player-initials', text: player.initials }),
      el(
        'span',
        { class: 'sb-player-score' },
        this.ghostEl,
        el('span', { class: 'score-view' }, this.rollEl),
        this.plusEl,
      ),
      el('span', { class: 'sb-player-label', text: 'COMPLETED' }),
    );
  }

  /**
   * @param {number} value
   * @param {{ animate?: boolean, celebrate?: boolean }} [opts]
   *   animate: roll the digits; celebrate: green flash + "+1" chip (made shot).
   */
  setScore(value, { animate = false, celebrate = false } = {}) {
    const prev = this.value;
    if (value === prev && !celebrate) return;
    this.value = value;
    this.el.setAttribute(
      'aria-label',
      `${this.player.initials} — ${value} completed task${value === 1 ? '' : 's'}`,
    );
    this.ghostEl.textContent = '8'.repeat(Math.max(2, String(value).length));

    if (!animate || value === prev) {
      this.rollEl.classList.remove('is-rolling');
      this.rollEl.textContent = String(value);
    } else {
      // Odometer roll: old number slides up and out, new slides in from below
      // (reversed when the score goes down, e.g. a completed task was deleted).
      window.clearTimeout(this.rollTimer);
      const goingUp = value > prev;
      this.rollEl.classList.remove('is-rolling');
      this.rollEl.replaceChildren(
        el('span', { class: 'roll-line', text: String(goingUp ? prev : value) }),
        el('span', { class: 'roll-line', text: String(goingUp ? value : prev) }),
      );
      this.rollEl.style.transform = goingUp ? 'translateY(0)' : 'translateY(-50%)';
      // Force the start position to take effect before transitioning.
      void this.rollEl.offsetHeight;
      this.rollEl.classList.add('is-rolling');
      this.rollEl.style.transform = goingUp ? 'translateY(-50%)' : 'translateY(0)';
      this.rollTimer = window.setTimeout(() => {
        this.rollEl.classList.remove('is-rolling');
        this.rollEl.style.transform = '';
        this.rollEl.textContent = String(value);
      }, 480);
    }

    if (celebrate) {
      window.clearTimeout(this.flashTimer);
      window.clearTimeout(this.plusTimer);
      this.el.classList.remove('is-scored');
      this.plusEl.classList.remove('is-live');
      void this.el.offsetWidth;
      this.el.classList.add('is-scored');
      this.plusEl.classList.add('is-live');
      this.flashTimer = window.setTimeout(() => this.el.classList.remove('is-scored'), 1000);
      this.plusTimer = window.setTimeout(() => this.plusEl.classList.remove('is-live'), 1300);
    }
  }
}
