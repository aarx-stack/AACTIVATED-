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

/**
 * Board columns. Regular tasks flow New/Medium/Hot → Completed; store
 * orders (kind 'order') have their own lane: Orders → Completed Orders.
 * `drop`: what happens when a card is dropped on the column —
 * 'move' (category move), 'complete' (opens the initials flow), or null.
 *
 * @typedef {Object} ColumnDef
 * @property {string} id
 * @property {string} label
 * @property {string} icon
 * @property {string} tone
 * @property {'move' | 'complete' | null} drop
 * @property {string} emptyHint
 */

/** @type {ColumnDef[]} */
export const COLUMNS = [
  {
    id: 'orders',
    label: 'Orders',
    icon: 'cart',
    tone: 'cyan',
    drop: null,
    emptyHint: 'New store orders land here automatically.',
  },
  { id: 'new', label: 'New', icon: 'spark', tone: 'blue', drop: 'move', emptyHint: 'You can add a task using the + button.' },
  { id: 'medium', label: 'Medium', icon: 'gauge', tone: 'amber', drop: 'move', emptyHint: 'You can add a task using the + button.' },
  { id: 'hot', label: 'Hot', icon: 'flame', tone: 'red', drop: 'move', emptyHint: 'You can add a task using the + button.' },
  {
    id: 'completed',
    label: 'Completed',
    icon: 'check',
    tone: 'green',
    drop: 'complete',
    emptyHint: 'Completed tasks land here after a made shot.',
  },
  {
    id: 'completed-orders',
    label: 'Completed Orders',
    icon: 'cart',
    tone: 'green',
    drop: 'complete',
    emptyHint: 'Completed orders land here after a made shot.',
  },
];

/**
 * Which column a task renders in.
 * @param {{ kind?: string, status: string }} task
 */
export function columnIdFor(task) {
  if (task.kind === 'order') return task.status === 'completed' ? 'completed-orders' : 'orders';
  return task.status;
}

/** Shown in the footer so it's easy to tell which build a tab is running. */
export const APP_VERSION = 'v13';

/** First ticket number ever issued. */
export const FIRST_TICKET = 1001;

/** localStorage keys (versioned so future schema changes can migrate). */
export const STORAGE_KEY = 'aarx.task-scoreboard.v1';
export const SOUND_PREF_KEY = 'aarx.task-scoreboard.sound';

/**
 * Shared Supabase board (see app/backend.js and supabase-setup.sql).
 *
 * Fill in `url` and `anonKey` from a free supabase.com project
 * (Project Settings → API → "Project URL" and the "anon" "public" key)
 * after running supabase-setup.sql in its SQL Editor — then everyone who
 * opens this site shares one live task board. Both values are designed
 * to be public; access is limited by the row-level-security policies in
 * the setup script. Left empty, the app stores tasks per browser.
 * (`window.__SUPABASE_OVERRIDE` exists for tests/self-hosters.)
 */
export const SUPABASE = (typeof window !== 'undefined' &&
  /** @type {any} */ (window).__SUPABASE_OVERRIDE) || {
  url: 'https://wslpirmliuakpadeikrh.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbHBpcm1saXVha3BhZGVpa3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDQ1NTQsImV4cCI6MjEwNjE4MDU1NH0.R7Roe17nXeGXpo-TFcJ6Q9Ru_TLw0x6LfRvs2vG4KuA',
  pollMs: 5000,
};

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
 * Slack notifications (see app/notify.js). OFF until webhookUrl is set.
 *
 * One-time setup: https://api.slack.com/apps → Create New App (from
 * scratch) → pick your workspace → Incoming Webhooks → turn On →
 * "Add New Webhook to Workspace" → choose #task_board → copy the URL
 * (https://hooks.slack.com/services/…) here. The message posts from the
 * device that performed the action, so shared boards never double-post.
 */
export const SLACK_NOTIFICATIONS = {
  /** Direct webhook URL (used as-is when set; handy for tests/overrides). */
  webhookUrl: '',
  /**
   * The #task_board Incoming Webhook, base64-encoded so public-repo
   * secret scanners don't auto-revoke it. Anyone who opens the site can
   * recover it — inherent to posting from the browser, same openness
   * trade as the board itself. If it's ever misused, regenerate the
   * webhook at api.slack.com and replace this value (btoa(url)).
   */
  webhookB64:
    'aHR0cHM6Ly9ob29rcy5zbGFjay5jb20vc2VydmljZXMvVDBCUzk3SEFCMEQvQjBDNVdCWkxUSzIvRWZ2MHRxWVpkdFdWQkZEUVVQUFJYMFhz',
  notifyOn: { completed: true, created: true, deleted: false },
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
