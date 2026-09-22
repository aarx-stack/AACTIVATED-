// @ts-check

/**
 * ShotDirector — runs the basketball scoring animation and owns the
 * "one shot = one completed task = one point" guarantee.
 *
 * Shots are queued and played one at a time. Each queued job holds exactly
 * one pending completion; the store commit (status + completedBy +
 * completedAt + unique shotId, all in one transaction) fires exactly once
 * per job, at the moment the ball passes the rim. Every code path — normal
 * flight, reduced motion, animation failure, hidden tab — funnels through
 * the same guarded commit, so the animation can never double-score or skip
 * a completion. A watchdog force-finishes any shot whose animation stalls.
 */

import { store } from './store.js';
import { sound } from './sound.js';
import { basketballSvg } from './dom.js';

/**
 * @typedef {Object} ShotJob
 * @property {string} taskId
 * @property {string} initials
 * @property {{x: number, y: number} | null} origin  Launch point (client coords).
 * @property {boolean} committed
 * @property {boolean} finished
 */

const FLIGHT_MS = 720;
const SETTLE_MS = 420;

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

class ShotDirector {
  constructor() {
    /** @type {ShotJob[]} */
    this.queue = [];
    this.running = false;
    /** @type {{ rimPoint: () => {x:number,y:number}|null, playMake: () => void, el: HTMLElement } | null} */
    this.stage = null;

    // Reusable flight layer: a fixed, pointer-transparent overlay so the
    // ball can fly from anywhere on the page into the scoreboard hoop.
    this.layer = document.createElement('div');
    this.layer.className = 'shot-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.ball = document.createElement('div');
    this.ball.className = 'shot-ball';
    this.ball.appendChild(basketballSvg(44));
    /** @type {HTMLElement[]} */
    this.ghosts = [];
    for (let i = 0; i < 3; i++) {
      const g = document.createElement('div');
      g.className = 'shot-ghost';
      g.appendChild(basketballSvg(44));
      this.ghosts.push(g);
      this.layer.appendChild(g);
    }
    this.layer.appendChild(this.ball);
    document.body.appendChild(this.layer);
  }

  /**
   * Called by the hoop stage component when it mounts.
   * @param {{ rimPoint: () => {x:number,y:number}|null, playMake: () => void, el: HTMLElement }} stage
   */
  registerStage(stage) {
    this.stage = stage;
  }

  /**
   * Queue the completion shot for a task. The task must already be locked
   * via store.lockForCompletion (the modal does this); the director releases
   * the lock when the shot fully settles.
   * @param {{ taskId: string, initials: string, origin?: {x:number,y:number} | null }} input
   */
  enqueue({ taskId, initials, origin = null }) {
    this.queue.push({ taskId, initials, origin, committed: false, finished: false });
    if (!this.running) this.run();
  }

  /**
   * The single scoring commit for a job. Guarded so it can only ever run
   * once per job, no matter which animation path (or failure path) calls it.
   * @param {ShotJob} job
   */
  commit(job) {
    if (job.committed) return;
    job.committed = true;
    const result = store.completeTask(job.taskId, job.initials);
    if (result.ok) {
      // Make-shot feedback happens only on a real, first-time completion.
      try {
        this.stage?.playMake();
      } catch {
        /* cosmetic only */
      }
      sound.swish();
      setTimeout(() => sound.score(), 140);
    }
  }

  async run() {
    this.running = true;
    while (this.queue.length > 0) {
      const job = /** @type {ShotJob} */ (this.queue.shift());
      try {
        await this.playShot(job);
      } catch {
        /* animation errors must never lose the completion */
      } finally {
        this.commit(job); // no-op when the flight already committed at the rim
        job.finished = true;
        store.releaseCompletionLock(job.taskId);
      }
      await wait(SETTLE_MS);
    }
    this.running = false;
  }

  /** @param {ShotJob} job */
  async playShot(job) {
    const stageEl = this.stage?.el;
    const reduced = prefersReducedMotion();

    // Bring the hoop into view if the user has scrolled deep into the board.
    if (stageEl && !inViewport(stageEl)) {
      stageEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
      await wait(reduced ? 40 : 380);
    }

    const rim = this.stage?.rimPoint() || null;
    if (reduced || !rim) {
      // Simplified experience: no flight, brief pause so the completion still
      // reads as an event, then the same single commit (score still updates).
      await wait(140);
      this.commit(job);
      return;
    }

    const from = clampPoint(
      job.origin || { x: window.innerWidth / 2, y: window.innerHeight - 80 },
    );

    // Quadratic bezier arc with an apex safely inside the viewport.
    const apexLift = Math.max(90, Math.abs(from.y - rim.y) * 0.35 + 70);
    const cp = {
      x: from.x + (rim.x - from.x) * 0.46,
      y: Math.max(16, Math.min(from.y, rim.y) - apexLift),
    };
    const spin = (rim.x >= from.x ? 1 : -1) * 520;
    const duration = Math.min(
      980,
      Math.max(FLIGHT_MS, Math.hypot(rim.x - from.x, rim.y - from.y) * 0.62),
    );

    this.layer.classList.add('is-active');
    const ball = this.ball;
    ball.style.opacity = '1';

    await new Promise((resolve) => {
      let start = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        ball.style.opacity = '0';
        for (const g of this.ghosts) g.style.opacity = '0';
        this.layer.classList.remove('is-active');
        this.commit(job); // the ball is through the rim — score now
        resolve(undefined);
      };
      // If rAF stalls (hidden tab, rendering failure), the completion still
      // lands exactly once.
      const watchdog = setTimeout(finish, duration + 1500);

      const frame = (/** @type {number} */ now) => {
        if (done) return;
        if (!start) start = now;
        const t = Math.min(1, (now - start) / duration);
        const e = easeInOutSlight(t);
        place(ball, bezier(from, cp, rim, e), {
          rotate: spin * e,
          scale: 1 - 0.32 * e, // shrink toward the hoop for depth
        });
        this.ghosts.forEach((g, i) => {
          const gt = e - 0.055 * (i + 1);
          if (gt <= 0.02) {
            g.style.opacity = '0';
            return;
          }
          g.style.opacity = String(0.16 - i * 0.045);
          place(g, bezier(from, cp, rim, gt), { rotate: spin * gt, scale: 1 - 0.32 * gt });
        });
        if (t >= 1) finish();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }
}

/** @param {HTMLElement} node @param {{x:number,y:number}} p */
function place(node, p, { rotate = 0, scale = 1 } = {}) {
  node.style.transform = `translate3d(${p.x - 22}px, ${p.y - 22}px, 0) rotate(${rotate}deg) scale(${scale})`;
}

/**
 * @param {{x:number,y:number}} p0 @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2 @param {number} t
 */
function bezier(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/**
 * Fast launch, floaty apex, fast drop — how a real arcing shot moves along
 * its path. An ease-out/ease-in pair blended with linear so the ball never
 * fully stalls at the apex.
 * @param {number} t
 */
function easeInOutSlight(t) {
  let shaped;
  if (t < 0.5) {
    const u = 2 * t;
    shaped = 0.5 * u * (2 - u); // ease-out up to the apex
  } else {
    const u = 2 * t - 1;
    shaped = 0.5 + 0.5 * u * u; // ease-in down to the rim
  }
  return 0.35 * t + 0.65 * shaped;
}

/** @param {{x:number,y:number}} p */
function clampPoint(p) {
  return {
    x: Math.max(24, Math.min(window.innerWidth - 24, p.x)),
    y: Math.max(24, Math.min(window.innerHeight - 24, p.y)),
  };
}

/** @param {HTMLElement} node */
function inViewport(node) {
  const r = node.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

export const shotDirector = new ShotDirector();
