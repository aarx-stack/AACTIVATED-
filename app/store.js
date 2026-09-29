// @ts-check

/**
 * Application state store.
 *
 * The task list is the single source of truth. Scoreboard values and column
 * counts are always derived from it (never stored separately), so they can
 * never drift out of sync — including after deletes and reloads.
 *
 * Storage has two modes:
 *  - Local (default): localStorage behind load()/save(), as before.
 *  - Shared (when a backend is attached, see app/backend.js): every
 *    mutation is written to the shared database and the store's state is
 *    rebuilt from live snapshots, so all devices/viewers see the same
 *    tasks in near-real time. localStorage then acts only as a warm-start
 *    cache. Store events carry origin: 'local' | 'remote' so, e.g., email
 *    notifications fire only on the device that performed the action.
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
 * @property {'task' | 'order'} kind  Regular task, or a store order (own columns).
 * @property {string | null} assignedTo   Player initials this task is assigned to.
 * @property {string} createdAt      ISO timestamp.
 * @property {string | null} completedAt
 * @property {string | null} completedBy   Player initials.
 * @property {number | null} timeSpentMinutes  How long the task took (set at completion).
 * @property {string | null} shotId  Unique scoring-event id ("SHOT-1042").
 *
 * @typedef {Object} State
 * @property {1} version
 * @property {number} nextTicketNumber
 * @property {Task[]} tasks
 *
 * @typedef {{ type: string, origin?: 'local' | 'remote', [key: string]: any }} StoreEvent
 *
 * @typedef {Object} TaskEdit  A validated edit (see Store#updateTask).
 * @property {string} [title]
 * @property {string} [notes]
 * @property {StatusId} [status]
 * @property {string | null} [assignedTo]
 *
 * @typedef {Object} Backend
 * @property {string} kind
 * @property {(task: Task) => Promise<void>} createTask
 * @property {(task: Task) => Promise<void>} writeTask
 * @property {(id: string, edit: TaskEdit) => Promise<void>} editTask
 *           Applies the edit (via applyEdit) to the latest shared copy.
 * @property {(id: string) => Promise<void>} deleteTask
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
 * Validate and repair a raw task record (from storage or the shared
 * database). Returns null for anything unusable.
 * @param {any} t
 * @returns {Task | null}
 */
export function sanitizeTask(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.title !== 'string' || !t.title || !VALID_STATUSES.has(t.status)) return null;
  const ticket = Number(t.ticketNumber);
  if (!Number.isInteger(ticket)) return null;
  const completed = t.status === 'completed';
  return {
    id: typeof t.id === 'string' && t.id ? t.id : makeId(),
    ticketNumber: ticket,
    title: t.title,
    notes: typeof t.notes === 'string' ? t.notes : '',
    status: t.status,
    // Store orders get their own board lane. Older webhook-created rows
    // carry no kind field, so the sellavi- id prefix also marks them.
    kind: t.kind === 'order' || String(t.id || '').startsWith('sellavi-') ? 'order' : 'task',
    assignedTo: typeof t.assignedTo === 'string' && t.assignedTo ? t.assignedTo : null,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
    completedAt: completed && typeof t.completedAt === 'string' ? t.completedAt : null,
    completedBy: completed && typeof t.completedBy === 'string' ? t.completedBy : null,
    timeSpentMinutes:
      completed && Number.isFinite(t.timeSpentMinutes) && t.timeSpentMinutes > 0
        ? Math.round(t.timeSpentMinutes)
        : null,
    shotId: completed ? (typeof t.shotId === 'string' ? t.shotId : `SHOT-${ticket}`) : null,
  };
}

/**
 * Apply a validated edit to a task — the one place that decides what an
 * edit may change. Completion and scoring fields are never touched, and
 * the category only changes on active regular tasks, so an edit landing
 * on a copy that was completed elsewhere in the meantime keeps that
 * completion (and its point). Returns a new object.
 * @param {Task} task
 * @param {TaskEdit} edit
 * @returns {Task}
 */
export function applyEdit(task, edit) {
  const next = { ...task };
  if (edit.title !== undefined) next.title = edit.title;
  if (edit.notes !== undefined) next.notes = edit.notes;
  if (edit.assignedTo !== undefined) next.assignedTo = edit.assignedTo;
  if (edit.status !== undefined && task.status !== 'completed' && task.kind !== 'order') {
    next.status = edit.status;
  }
  return next;
}

/**
 * Validate and repair a state object loaded from storage. Drops malformed
 * or duplicate-id tasks and self-heals the ticket counter so numbers are
 * never reused.
 * @param {unknown} raw
 * @returns {State}
 */
function sanitize(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;
  const src = /** @type {Record<string, any>} */ (raw);
  const seenIds = new Set();

  if (Array.isArray(src.tasks)) {
    for (const entry of src.tasks) {
      const task = sanitizeTask(entry);
      if (!task || seenIds.has(task.id)) continue;
      seenIds.add(task.id);
      state.tasks.push(task);
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
    /** @type {Backend | null} */
    this.backend = null;
    this.backendDegraded = false;

    // Keep multiple open tabs in sync (local mode; in shared mode the
    // live subscription covers this and the extra refresh is harmless).
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && !this.backend) {
          this.state = this.load();
          this.emit({ type: 'sync', origin: 'remote' });
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
    if (!event.origin) event.origin = 'local';
    for (const fn of [...this.listeners]) fn(event);
  }

  // ----- shared backend -------------------------------------------------

  /**
   * Switch to shared storage (see app/backend.js). From here on mutations
   * are written to the shared database and state follows its snapshots.
   * @param {Backend} backend
   */
  attachBackend(backend) {
    this.backend = backend;
  }

  noteBackendDegraded() {
    if (!this.backendDegraded) {
      this.backendDegraded = true;
      this.emit({ type: 'backend-degraded' });
    }
  }

  noteBackendRecovered() {
    if (this.backendDegraded) {
      this.backendDegraded = false;
      this.emit({ type: 'backend-recovered' });
    }
  }

  /**
   * Replace state from a shared-database snapshot and emit what changed.
   * @param {Task[]} tasks
   * @param {{ firstSync?: boolean,
   *           changes?: { type: 'added'|'modified'|'removed', id: string, task: Task | null }[],
   *           isLocal?: (id: string) => boolean }} [opts]
   */
  applyRemoteState(tasks, { firstSync = false, changes = [], isLocal = () => false } = {}) {
    const prevById = new Map(this.state.tasks.map((t) => [t.id, t]));
    const sorted = [...tasks].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const maxTicket = sorted.reduce((m, t) => Math.max(m, t.ticketNumber), FIRST_TICKET - 1);
    this.state = {
      version: 1,
      nextTicketNumber: Math.max(maxTicket + 1, FIRST_TICKET),
      tasks: sorted,
    };
    this.save(); // warm-start cache for the next load

    if (firstSync) {
      this.emit({ type: 'sync', origin: 'remote' });
      return;
    }
    for (const change of changes) {
      const origin = isLocal(change.id) ? 'local' : 'remote';
      if (change.type === 'added') {
        const task = this.getTask(change.id);
        if (task) this.emit({ type: 'task-created', task, origin });
      } else if (change.type === 'removed') {
        this.emit({ type: 'task-deleted', task: change.task || prevById.get(change.id), origin });
      } else {
        const prev = prevById.get(change.id);
        const now = this.getTask(change.id);
        if (!now) continue;
        if (prev?.status !== 'completed' && now.status === 'completed') {
          this.emit({ type: 'task-completed', task: now, origin });
        } else if (prev && prev.status !== now.status) {
          this.emit({ type: 'task-moved', task: now, origin });
        } else {
          this.emit({ type: 'sync', origin });
        }
      }
    }
  }

  /** @param {Promise<void>} write */
  guardWrite(write) {
    write.catch((err) => {
      console.warn('[store] shared write failed:', err);
      this.noteBackendDegraded();
    });
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
   * @param {{ title: string, notes?: string, status?: StatusId, assignedTo?: string | null }} input
   * @returns {Task}
   */
  createTask({ title, notes = '', status = 'new', assignedTo = null }) {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('Task title is required.');
    if (!ACTIVE_STATUSES.includes(status)) status = 'new';
    const assignee = normalizeInitials(assignedTo || '');
    /** @type {Task} */
    const task = {
      id: makeId(),
      ticketNumber: this.state.nextTicketNumber,
      title: cleanTitle,
      notes: notes.trim(),
      status,
      kind: 'task',
      assignedTo: isValidPlayer(assignee) ? assignee : null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedBy: null,
      timeSpentMinutes: null,
      shotId: null,
    };
    if (this.backend) {
      // Provisional bump so rapid local creates don't reuse a number; the
      // backend claims the authoritative ticket and the snapshot echo
      // delivers the final task (and the 'task-created' event).
      this.state.nextTicketNumber += 1;
      this.guardWrite(this.backend.createTask(task));
      return task;
    }
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
    if (task.kind === 'order') return false; // orders stay in their own lane
    if (!ACTIVE_STATUSES.includes(status) || task.status === status) return false;
    if (this.backend) {
      this.guardWrite(this.backend.writeTask({ ...task, status }));
      return true;
    }
    task.status = status;
    this.save();
    this.emit({ type: 'task-moved', task });
    return true;
  }

  /**
   * Edit a task's details: title, notes, category and assignee. Never
   * touches completion or scoring fields (completedBy, completedAt, time
   * spent, shotId) — completing still requires the initials popup, so an
   * edit can't add or remove points. Orders keep their own lane and
   * completed tasks stay completed; a category change only applies to
   * active regular tasks.
   * @param {string} id
   * @param {{ title?: string, notes?: string, status?: StatusId, assignedTo?: string | null }} patch
   * @returns {{ ok: true, task: Task, changed: boolean } | { ok: false, reason: 'not-found' | 'locked' | 'invalid-title' }}
   */
  updateTask(id, patch) {
    const task = this.getTask(id);
    if (!task) return { ok: false, reason: 'not-found' };
    if (this.isLocked(id)) return { ok: false, reason: 'locked' };

    /** @type {TaskEdit} */
    const edit = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) return { ok: false, reason: 'invalid-title' };
      edit.title = title;
    }
    if (patch.notes !== undefined) edit.notes = patch.notes.trim();
    if (patch.assignedTo !== undefined) {
      const assignee = normalizeInitials(patch.assignedTo || '');
      edit.assignedTo = isValidPlayer(assignee) ? assignee : null;
    }
    if (patch.status !== undefined && ACTIVE_STATUSES.includes(patch.status)) {
      edit.status = patch.status;
    }

    const next = applyEdit(task, edit);
    const changed =
      next.title !== task.title ||
      next.notes !== task.notes ||
      next.status !== task.status ||
      next.assignedTo !== task.assignedTo;
    if (!changed) return { ok: true, task, changed: false };

    if (this.backend) {
      // The adapter applies the edit to the latest shared copy, so a
      // completion or delete made on another device a moment ago is kept.
      // The snapshot echo then updates state and re-renders the board.
      this.guardWrite(this.backend.editTask(id, edit));
      return { ok: true, task: next, changed: true };
    }
    Object.assign(task, next);
    this.save();
    this.emit({ type: 'task-updated', task });
    return { ok: true, task, changed: true };
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
   * Atomically commit a completion: status, completedBy, completedAt,
   * timeSpentMinutes and the unique scoring event (shotId) are written
   * together, then persisted once. Idempotent — a task that is already
   * completed can never score again.
   * @param {string} id
   * @param {string} rawInitials
   * @param {number | null} [timeSpentMinutes] Whole minutes the task took.
   * @returns {{ ok: true, task: Task } | { ok: false, reason: string }}
   */
  completeTask(id, rawInitials, timeSpentMinutes = null) {
    const task = this.getTask(id);
    if (!task) return { ok: false, reason: 'not-found' };
    if (task.status === 'completed' || task.shotId) return { ok: false, reason: 'already-completed' };
    const initials = normalizeInitials(rawInitials);
    if (!isValidPlayer(initials)) return { ok: false, reason: 'invalid-initials' };
    const minutes =
      Number.isFinite(timeSpentMinutes) && /** @type {number} */ (timeSpentMinutes) > 0
        ? Math.round(/** @type {number} */ (timeSpentMinutes))
        : null;

    if (this.backend) {
      /** @type {Task} */
      const completed = {
        ...task,
        status: 'completed',
        completedBy: initials,
        completedAt: new Date().toISOString(),
        timeSpentMinutes: minutes,
        shotId: `SHOT-${task.ticketNumber}`,
      };
      // The snapshot echo (latency-compensated, effectively immediate)
      // updates state and emits 'task-completed'.
      this.guardWrite(this.backend.writeTask(completed));
      return { ok: true, task: completed };
    }

    task.status = 'completed';
    task.completedBy = initials;
    task.completedAt = new Date().toISOString();
    task.timeSpentMinutes = minutes;
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
    if (this.backend) {
      this.guardWrite(this.backend.deleteTask(id));
      return true;
    }
    const [task] = this.state.tasks.splice(index, 1);
    this.save();
    // Scoreboard listeners re-derive scores, so deleting a completed task
    // lowers that player's total automatically.
    this.emit({ type: 'task-deleted', task });
    return true;
  }
}

export const store = new Store();
