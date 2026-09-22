// @ts-check

/**
 * Optional sound effects, synthesized with the Web Audio API (no audio
 * files). Sounds only ever play in direct response to a user action, so
 * autoplay restrictions are respected; everything is wrapped defensively
 * so audio can never break the app. A persistent toggle lives on the
 * scoreboard.
 */

import { SOUND_PREF_KEY } from './config.js';

let ctx = /** @type {AudioContext | null} */ (null);
let enabled = readPref();

function readPref() {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function context() {
  if (!ctx) {
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export const sound = {
  get enabled() {
    return enabled;
  },

  /** @param {boolean} value */
  setEnabled(value) {
    enabled = value;
    try {
      localStorage.setItem(SOUND_PREF_KEY, value ? 'on' : 'off');
    } catch {
      /* preference just won't persist */
    }
  },

  /** Soft "swish" — a short band-passed noise sweep, like ball through net. */
  swish() {
    if (!enabled) return;
    try {
      const ac = context();
      if (!ac) return;
      const now = ac.currentTime;
      const dur = 0.28;
      const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.9;
      filter.frequency.setValueAtTime(3200, now);
      filter.frequency.exponentialRampToValueAtTime(700, now + dur);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(now);
      src.stop(now + dur);
    } catch {
      /* never let audio break the flow */
    }
  },

  /** Gentle two-note score blip. */
  score() {
    if (!enabled) return;
    try {
      const ac = context();
      if (!ac) return;
      const now = ac.currentTime;
      for (const [offset, freq] of [
        [0, 740],
        [0.09, 1108.7],
      ]) {
        const osc = ac.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ac.createGain();
        const t = now + offset;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.24);
      }
    } catch {
      /* ignore */
    }
  },
};
