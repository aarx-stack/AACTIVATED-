// @ts-check

/**
 * The arena scoreboard — the centerpiece at the top of the app.
 * Player scores are always re-derived from the store (never incremented
 * locally), so the board can't drift from the task data.
 */

import { PLAYERS } from '../config.js';
import { store } from '../store.js';
import { sound } from '../sound.js';
import { el, icon } from '../dom.js';
import { ScoreboardPlayer } from './ScoreboardPlayer.js';
import { HoopStage } from './HoopStage.js';

export class Scoreboard {
  constructor() {
    /** @type {number | undefined} */
    this.celebrateTimer = undefined;
    /** @type {Map<string, ScoreboardPlayer>} */
    this.players = new Map();
    for (const p of PLAYERS) this.players.set(p.initials, new ScoreboardPlayer(p));

    this.stage = new HoopStage();
    this.clockEl = el('span', { class: 'sb-clock led' });
    this.totalEl = el('span', { class: 'sb-total led', text: '000' });
    this.liveEl = el('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

    this.soundBtn = el(
      'button',
      {
        class: 'sb-sound',
        type: 'button',
        'aria-pressed': String(sound.enabled),
        'aria-label': 'Sound effects',
        title: 'Toggle sound effects',
        onclick: () => {
          sound.setEnabled(!sound.enabled);
          this.renderSoundButton();
          if (sound.enabled) sound.score();
        },
      },
    );
    this.renderSoundButton();

    this.el = el(
      'section',
      { class: 'scoreboard', 'aria-label': 'Task scoreboard' },
      el(
        'header',
        { class: 'sb-top' },
        el('span', { class: 'sb-dot', 'aria-hidden': 'true' }),
        el('h2', { class: 'sb-title', text: 'TASK SCOREBOARD' }),
        el('span', { class: 'sb-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'sb-top-right' }, this.clockEl, this.soundBtn),
      ),
      el(
        'div',
        { class: 'sb-main' },
        el('div', { class: 'sb-players' }, ...[...this.players.values()].map((p) => p.el)),
        this.stage.el,
      ),
      el(
        'footer',
        { class: 'sb-ticker' },
        el('span', { class: 'sb-ticker-item' }, 'TEAM TOTAL ', this.totalEl),
        el('span', { class: 'sb-ticker-rule', text: '1 SHOT · 1 TASK · 1 POINT' }),
      ),
      this.liveEl,
    );

    this.tickClock();
    window.setInterval(() => this.tickClock(), 15_000);

    store.subscribe((event) => this.onStoreEvent(event));
    this.refresh();
  }

  renderSoundButton() {
    this.soundBtn.replaceChildren(icon(sound.enabled ? 'soundOn' : 'soundOff', 16));
    this.soundBtn.setAttribute('aria-pressed', String(sound.enabled));
    this.soundBtn.setAttribute(
      'aria-label',
      sound.enabled ? 'Sound effects on' : 'Sound effects off',
    );
  }

  tickClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    this.clockEl.replaceChildren(hh, el('span', { class: 'sb-colon', text: ':' }), mm);
    this.clockEl.setAttribute('aria-label', `Current time ${hh}:${mm}`);
  }

  /** @param {import('../store.js').StoreEvent} event */
  onStoreEvent(event) {
    switch (event.type) {
      case 'task-completed': {
        const by = event.task?.completedBy;
        this.refresh({ animate: true, celebrate: by });
        if (event.task) {
          const score = store.scores()[by] ?? 0;
          this.liveEl.textContent =
            `Task number ${event.task.ticketNumber} completed by ${by}. ` +
            `${by} now has ${score} completed task${score === 1 ? '' : 's'}.`;
        }
        // Brief celebratory glow on the whole board.
        this.el.classList.remove('is-celebrating');
        void this.el.offsetWidth;
        this.el.classList.add('is-celebrating');
        window.clearTimeout(this.celebrateTimer);
        this.celebrateTimer = window.setTimeout(
          () => this.el.classList.remove('is-celebrating'),
          1100,
        );
        break;
      }
      case 'task-deleted':
      case 'sync':
        this.refresh({ animate: true });
        break;
      case 'task-created':
      case 'task-moved':
        break; // active tasks don't change scores
      default:
        break;
    }
  }

  /**
   * Re-derive every number from the store.
   * @param {{ animate?: boolean, celebrate?: string | null }} [opts]
   */
  refresh({ animate = false, celebrate = null } = {}) {
    const scores = store.scores();
    for (const [initials, panel] of this.players) {
      panel.setScore(scores[initials] ?? 0, {
        animate,
        celebrate: celebrate === initials,
      });
    }
    this.totalEl.textContent = String(store.teamTotal()).padStart(3, '0');
  }
}
