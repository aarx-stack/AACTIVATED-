// @ts-check

/**
 * Shared storage backend.
 *
 * When the app runs as a published claude.ai artifact, the artifact
 * runtime offers a shared realtime document database (`db` capability).
 * This module connects the store to it: one document per task in the
 * `tasks` collection, a `meta/tickets` counter guarded by a short lease
 * so ticket numbers stay unique across devices, and a live subscription
 * that keeps every open device in sync without refreshing.
 *
 * Anywhere else (GitHub Pages, localhost) `claude.use` doesn't exist,
 * init resolves null, and the store keeps its localStorage behavior.
 */

import { FIRST_TICKET } from './config.js';
import { sanitizeTask } from './store.js';

/** Stable per-page-load id, used as the lease holder. */
const CLIENT_ID = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/** How long a locally-initiated write counts as "ours" when its echo
 * arrives, so events carry the right origin. */
const LOCAL_ECHO_WINDOW_MS = 20000;

/** @param {import('./store.js').Task} t */
function taskBody(t) {
  return {
    id: t.id,
    ticketNumber: t.ticketNumber,
    title: t.title,
    notes: t.notes,
    status: t.status,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    completedBy: t.completedBy,
    shotId: t.shotId,
  };
}

/**
 * Try to connect the store to the shared artifact database.
 * Resolves the backend when connected, or null when unavailable.
 * @param {typeof import('./store.js').store} store
 */
export async function initSharedBackend(store) {
  const claude = /** @type {any} */ (window).claude;
  if (!claude || typeof claude.use !== 'function') return null;

  /** @type {any} The runtime's DB namespace (no local type declarations). */
  let db = null;
  try {
    db = await claude.use('db');
  } catch {
    db = null;
  }
  if (!db) return null;

  const tasksCol = db.collection('tasks');

  // ----- first read + one-time seed from this device's local cache -----
  let initial;
  try {
    initial = await tasksCol.get();
  } catch (err) {
    console.warn('[shared] database unreachable, staying local:', err);
    return null;
  }

  const localTasks = store.getTasks();
  if (initial.empty && localTasks.length > 0) {
    // This artifact's database is brand new but this browser already has
    // tasks (from the pre-shared version). Migrate them once — a lease on
    // meta/setup keeps two devices from both seeding.
    try {
      const setup = db.doc('meta/setup');
      const lease = await setup.acquire({ holder: CLIENT_ID, ttlMs: 10000 });
      if (lease.acquired) {
        const snap = await setup.get();
        if (!snap.exists) {
          for (const t of localTasks) {
            await tasksCol.doc(t.id).set(taskBody(t));
          }
          await db.doc('meta/tickets').set({
            next: localTasks.reduce((m, t) => Math.max(m, t.ticketNumber + 1), FIRST_TICKET),
          });
          await setup.set({ seededAt: new Date().toISOString() });
        }
      }
    } catch (err) {
      console.warn('[shared] seeding local tasks failed:', err);
    }
  }

  // ----- origin tracking for snapshot echoes ---------------------------
  /** @type {Map<string, number>} */
  const localWrites = new Map();
  /** @param {string} id */
  function markLocal(id) {
    localWrites.set(id, Date.now());
  }
  /** @param {string} id */
  function isLocal(id) {
    const at = localWrites.get(id);
    return at !== undefined && Date.now() - at < LOCAL_ECHO_WINDOW_MS;
  }

  /**
   * Claim the next ticket number. A short lease on meta/tickets makes the
   * read-then-write safe against another device creating at the same
   * moment; if the lease is busy (someone else is mid-create) fall back
   * to the store's provisional number — worst case is a cosmetic
   * duplicate ticket, never a lost task.
   * @param {number} fallback
   */
  async function claimTicket(fallback) {
    try {
      const ref = db.doc('meta/tickets');
      const lease = await ref.acquire({ holder: CLIENT_ID, ttlMs: 4000 });
      if (lease.acquired) {
        const snap = await ref.get();
        const stored = snap.exists ? Number(snap.data()?.next) : NaN;
        const ticket = Math.max(Number.isInteger(stored) ? stored : FIRST_TICKET, fallback);
        await ref.set({ next: ticket + 1 });
        return ticket;
      }
    } catch {
      /* fall through to the provisional number */
    }
    return fallback;
  }

  /** @type {import('./store.js').Backend} */
  const backend = {
    kind: 'artifact-db',

    async createTask(task) {
      const ticketNumber = await claimTicket(task.ticketNumber);
      markLocal(task.id);
      await tasksCol.doc(task.id).set(taskBody({ ...task, ticketNumber }));
    },

    async writeTask(task) {
      markLocal(task.id);
      await tasksCol.doc(task.id).set(taskBody(task));
    },

    async deleteTask(id) {
      markLocal(id);
      await tasksCol.doc(id).delete();
    },
  };

  // ----- live subscription (registered once) ---------------------------
  let firstSnapshot = true;
  tasksCol.onSnapshot(
    (/** @type {any} */ snap) => {
      /** @type {import('./store.js').Task[]} */
      const tasks = [];
      for (const doc of snap.docs) {
        const task = sanitizeTask(doc.data());
        if (task) {
          task.id = doc.id; // the document id is authoritative
          tasks.push(task);
        }
      }
      const changes = firstSnapshot
        ? []
        : snap.docChanges().map((/** @type {any} */ c) => ({
            type: c.type,
            id: c.doc.id,
            task: sanitizeTask(c.doc.data()),
          }));
      store.applyRemoteState(tasks, { firstSync: firstSnapshot, changes, isLocal });
      firstSnapshot = false;
    },
    (/** @type {any} */ err) => {
      console.warn('[shared] live subscription lost:', err);
      store.noteBackendDegraded();
    },
  );

  return backend;
}
