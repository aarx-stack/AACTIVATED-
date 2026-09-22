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
 * Automatic email notifications (see app/notify.js).
 *
 * OFF until at least one recipient (or a webhook URL) is set — the app is
 * fully functional without it. Two delivery modes, no backend required:
 *
 * 1. `recipients`: email addresses, delivered through FormSubmit
 *    (https://formsubmit.co — free, no account). The FIRST notification
 *    sends each recipient a one-time activation email; after they click
 *    "Activate", every later notification arrives normally.
 * 2. `webhookUrl`: instead POSTs the event as JSON to your own endpoint
 *    (Zapier / Make / n8n / custom server) and no FormSubmit call is made —
 *    useful when you want your own email template or a shared audit trail.
 *
 * `notifyOn` picks which events send email.
 */
export const EMAIL_NOTIFICATIONS = {
  recipients: /** @type {string[]} */ ([]), // e.g. ['ops@example.com']
  notifyOn: { completed: true, created: false, deleted: false },
  webhookUrl: '',
};

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
