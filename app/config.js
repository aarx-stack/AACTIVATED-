// @ts-check

/**
 * Central configuration for the Task Scoreboard app.
 *
 * To add a team member, add an entry to PLAYERS — the scoreboard,
 * initials validation and quick-pick buttons all derive from this list.
 */

/** @typedef {{ initials: string, name: string }} Player */

/** @type {Player[]} */
export const PLAYERS = [
  { initials: 'JG', name: 'JG' },
  { initials: 'IM', name: 'IM' },
  { initials: 'GG', name: 'GG' },
];

/** @typedef {'new' | 'medium' | 'hot' | 'completed'} StatusId */

/**
 * @typedef {Object} StatusDef
 * @property {StatusId} id
 * @property {string} label
 * @property {string} icon    Icon name resolved by app/dom.js
 * @property {string} tone    CSS tone suffix (blue | amber | red | green)
 */

/** @type {StatusDef[]} */
export const STATUSES = [
  { id: 'new', label: 'New', icon: 'spark', tone: 'blue' },
  { id: 'medium', label: 'Medium', icon: 'gauge', tone: 'amber' },
  { id: 'hot', label: 'Hot', icon: 'flame', tone: 'red' },
  { id: 'completed', label: 'Completed', icon: 'check', tone: 'green' },
];

/** Statuses a task can be moved between without the completion flow. */
export const ACTIVE_STATUSES = /** @type {StatusId[]} */ (['new', 'medium', 'hot']);

/** First ticket number ever issued. */
export const FIRST_TICKET = 1001;

/** localStorage keys (versioned so future schema changes can migrate). */
export const STORAGE_KEY = 'aarx.task-scoreboard.v1';
export const SOUND_PREF_KEY = 'aarx.task-scoreboard.sound';

/**
 * Normalize raw initials input ("  jg " -> "JG").
 * @param {string} raw
 */
export function normalizeInitials(raw) {
  return (raw || '').trim().toUpperCase();
}

/**
 * @param {string} initials Normalized initials.
 * @returns {boolean}
 */
export function isValidPlayer(initials) {
  return PLAYERS.some((p) => p.initials === initials);
}

/** Human list of valid initials, for validation messages: "JG, IM, or GG". */
export function playerListPhrase() {
  const list = PLAYERS.map((p) => p.initials);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')}, or ${list[list.length - 1]}`;
}

/**
 * @param {StatusId} id
 * @returns {StatusDef}
 */
export function statusDef(id) {
  const def = STATUSES.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown status: ${id}`);
  return def;
}
