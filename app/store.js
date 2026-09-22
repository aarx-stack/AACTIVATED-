// @ts-check

/**
 * Application state store.
 *
 * The task list is the single source of truth. Scoreboard values and column
 * counts are always derived from it (never stored separately), so they can
 * never drift out of sync — including after deletes and reloads.
 *
 * Persistence is localStorage behind load()/save(); to migrate to a real
 * backend later, replace those two functions (or debounce save() into an
 * API call) — the rest of the app only talks to the store API.
 */

import {
  ACTIVE_STATUSES,
  FIRST_TICKET,
  PLAYERS,
  STORAGE_KEY,
  isValidPlayer,
  normalizeInitials,
} from './config.js';

/**
 * @typedef {import('./config.js').StatusId} StatusId
 *
 * @typedef {Object} Task
 * @property {string} id             Stable unique id.
 * @property {number} ticketNumber   Permanent ticket number (#1001, #1002, …).
 * @property {string} title
 * @property {string} notes
 * @property {StatusId} status
 * @property {string} createdAt      ISO timestamp.
 * @property {string | null} completedAt
 * @property {string | null} completedBy   Player initials.
 * @property {string | null} shotId  Unique scoring-event id ("SHOT-1042").
 *
 * @typedef {Object} State
 * @property {1} version
 * @property {number} nextTicketNumber
 * @property {Task[]} tasks
 *
 * @typedef {{ type: string, [key: string]: any }} StoreEvent
 */

/** @returns {State} */
function defaultState() {
  return { version: 1, nextTicketNumber: FIRST_TICKET, tasks: [] };
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const VALID_STATUSES = new Set(['new', 'medium', 'hot', 'completed']);

/**
 * Validate and repair a state object loaded from storage. Drops malformed
 * tasks and self-heals the ticket counter so numbers are never reused.
 * @param {unknown} raw
 * @returns {State}
 */
function sanitize(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;
  const src = /** @type {Record<string, any>} */ (raw);
  const seenTickets = new Set();

  if (Array.isArray(src.tasks)) {
    for (const t of src.tasks) {
      if (!t || typeof t !== 'object') continue;
      if (typeof t.title !== 'string' || !VALID_STATUSES.has(t.status)) continue;
      const ticket = Number(t.ticketNumber);
      if (!Number.isInteger(ticket) || seenTickets.has(ticket)) continue;
      seenTickets.add(ticket);
      const completed = t.status === 'completed';
      state.tasks.push({
        id: typeof t.id === 'string' && t.id ? t.id : makeId(),
        ticketNumber: ticket,
        title: t.title,
        notes: typeof t.notes === 'string' ? t.notes : '',
        status: t.status,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
        completedAt: completed && typeof t.completedAt === 'string' ? t.completedAt : null,
        completedBy: completed && typeof t.completedBy === 'string' ? t.completedBy : null,
        shotId: completed && typeof t.shotId === 'string' ? t.shotId : completed ? `SHOT-${ticket}` : null,
      });
    }
  }

  const maxTicket = state.tasks.reduce((m, t) => Math.max(m, t.ticketNumber), FIRST_TICKET - 1);
  const storedNext = Number(src.nextTicketNumber);
  state.nextTicketNumber = Math.max(
    Number.isInteger(storedNext) ? storedNext : FIRST_TICKET,
    maxTicket + 1,
    FIRST_TICKET,
  );
  return state;
}

class Store {
  constructor() {
    /** @type {State} */
    this.state = this.load();
    /** @type {Set<(e: StoreEvent) => void>} */
    this.listeners = new Set();
    /** Tasks whose completion (shot animation) is in flight. Not persisted:
     * a refresh mid-shot simply leaves the task active and unscored. */
    this.completionLocks = new Set();
    this.storageOk = true;

    // Keep multiple open tabs in sync.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
          this.state = this.load();
          this.emit({ type: 'sync' });
        }
      });
    }
  }

  /** @returns {State} */
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return sanitize(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      if (!this.storageOk) {
        this.storageOk = true;
        this.emit({ type: 'storage-status' });
      }
    } catch {
      if (this.storageOk) {
        this.storageOk = false;
        this.emit({ type: 'storage-status' });
      }
    }
  }

  /** @param {(e: StoreEvent) => void} fn */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** @param {StoreEvent} event */
  emit(event) {
    for (const fn of [...this.listeners]) fn(event);
  }

  // ----- queries -------------------------------------------------------

  /** @returns {Task[]} */
  getTasks() {
    return this.state.tasks;
  }

  /** @param {string} id */
  getTask(id) {
    return this.state.tasks.find((t) => t.id === id) || null;
  }

  /**
   * Scoreboard values, derived live from completed tasks.
   * @returns {Record<string, number>} initials -> completed count
   */
  scores() {
    /** @type {Record<string, number>} */
    const scores = {};
    for (const p of PLAYERS) scores[p.initials] = 0;
    for (const t of this.state.tasks) {
      if (t.status === 'completed' && t.completedBy && t.completedBy in scores) {
        scores[t.completedBy] += 1;
      }
    }
    return scores;
  }

  /** Total completed tasks (team total on the scoreboard). */
  teamTotal() {
    return this.state.tasks.filter((t) => t.status === 'completed').length;
  }

  /** @param {string} id */
  isLocked(id) {
    return this.completionLocks.has(id);
  }

  // ----- mutations -----------------------------------------------------

  /**
   * @param {{ title: string, notes?: string, status?: StatusId }} input
   * @returns {Task}
   */
  createTask({ title, notes = '', status = 'new' }) {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('Task title is required.');
    if (!ACTIVE_STATUSES.includes(status)) status = 'new';
    /** @type {Task} */
    const task = {
      id: makeId(),
      ticketNumber: this.state.nextTicketNumber,
      title: cleanTitle,
      notes: notes.trim(),
      status,
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedBy: null,
      shotId: null,
    };
    this.state.nextTicketNumber += 1;
    this.state.tasks.unshift(task);
    this.save();
    this.emit({ type: 'task-created', task });
    return task;
  }

  /**
   * Move a task between active columns (New / Medium / Hot). Moving into
   * Completed is intentionally impossible here — that requires the
   * completion flow (initials + shot) via lockForCompletion/completeTask.
   * @param {string} id
   * @param {StatusId} status
   */
  moveTask(id, status) {
    const task = this.getTask(id);
    if (!task || task.status === 'completed' || this.isLocked(id)) return false;
    if (!ACTIVE_STATUSES.includes(status) || task.status === status) return false;
    task.status = status;
    this.save();
    this.emit({ type: 'task-moved', task });
    return true;
  }

  /**
   * Lock a task while its completion shot is in flight, so it cannot be
   * completed (or deleted) twice. Returns false if already locked/completed.
   * @param {string} id
   */
  lockForCompletion(id) {
    const task = this.getTask(id);
    if (!task || task.status === 'completed' || this.completionLocks.has(id)) return false;
    this.completionLocks.add(id);
    this.emit({ type: 'task-locked', task });
    return true;
  }

  /** @param {string} id */
  releaseCompletionLock(id) {
    if (this.completionLocks.delete(id)) {
      this.emit({ type: 'task-unlocked', task: this.getTask(id) });
    }
  }

  /**
   * Atomically commit a completion: status, completedBy, completedAt and the
   * unique scoring event (shotId) are written together, then persisted once.
   * Idempotent — a task that is already completed can never score again.
   * @param {string} id
   * @param {string} rawInitials
   * @returns {{ ok: true, task: Task } | { ok: false, reason: string }}
   */
  completeTask(id, rawInitials) {
    const task = this.getTask(id);
    if (!task) return { ok: false, reason: 'not-found' };
    if (task.status === 'completed' || task.shotId) return { ok: false, reason: 'already-completed' };
    const initials = normalizeInitials(rawInitials);
    if (!isValidPlayer(initials)) return { ok: false, reason: 'invalid-initials' };

    task.status = 'completed';
    task.completedBy = initials;
    task.completedAt = new Date().toISOString();
    task.shotId = `SHOT-${task.ticketNumber}`;
    this.save();
    this.emit({ type: 'task-completed', task });
    return { ok: true, task };
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  deleteTask(id) {
    if (this.isLocked(id)) return false;
    const index = this.state.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;
    const [task] = this.state.tasks.splice(index, 1);
    this.save();
    // Scoreboard listeners re-derive scores, so deleting a completed task
    // lowers that player's total automatically.
    this.emit({ type: 'task-deleted', task });
    return true;
  }
}

export const store = new Store();
