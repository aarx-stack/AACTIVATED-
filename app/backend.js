// @ts-check

/**
 * Shared storage backends. Tried in order at startup:
 *
 *  1. Artifact database — when the app runs as a published claude.ai
 *     artifact, its runtime offers a shared realtime document store
 *     (`db` capability): one document per task, a lease-guarded ticket
 *     counter, and a live subscription.
 *
 *  2. Supabase — when SUPABASE in config.js is filled in (a free
 *     supabase.com project set up with supabase-setup.sql), tasks live
 *     in a shared Postgres table reached over plain REST: anyone who
 *     opens the page shares one live board. Updates are picked up by
 *     light polling (default every 5s, immediately after this device
 *     writes and when the tab regains focus). The anon key is a
 *     publishable client key — row-level-security policies from the
 *     setup script are what limit access.
 *
 *  3. Neither available: the store keeps its per-browser localStorage
 *     behavior unchanged.
 */

import { FIRST_TICKET, SUPABASE } from './config.js';
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
    kind: t.kind,
    assignedTo: t.assignedTo,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    completedBy: t.completedBy,
    timeSpentMinutes: t.timeSpentMinutes,
    shotId: t.shotId,
  };
}

/** Origin tracking shared by both adapters. */
function makeLocalMarks() {
  /** @type {Map<string, number>} */
  const marks = new Map();
  return {
    /** @param {string} id */
    mark(id) {
      marks.set(id, Date.now());
    },
    /** @param {string} id */
    isLocal(id) {
      const at = marks.get(id);
      return at !== undefined && Date.now() - at < LOCAL_ECHO_WINDOW_MS;
    },
  };
}

/**
 * Try to connect the store to a shared backend.
 * Resolves the backend when connected, or null when unavailable.
 * @param {typeof import('./store.js').store} store
 */
export async function initSharedBackend(store) {
  const viaArtifact = await initArtifactBackend(store);
  if (viaArtifact) return viaArtifact;
  return initSupabaseBackend(store);
}

// ---------------------------------------------------------------------
// 1) claude.ai artifact database
// ---------------------------------------------------------------------

/** @param {typeof import('./store.js').store} store */
async function initArtifactBackend(store) {
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
    console.warn('[shared] artifact database unreachable, staying local:', err);
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

  const local = makeLocalMarks();

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
      local.mark(task.id);
      await tasksCol.doc(task.id).set(taskBody({ ...task, ticketNumber }));
    },

    async writeTask(task) {
      local.mark(task.id);
      await tasksCol.doc(task.id).set(taskBody(task));
    },

    async deleteTask(id) {
      local.mark(id);
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
      store.applyRemoteState(tasks, { firstSync: firstSnapshot, changes, isLocal: local.isLocal });
      firstSnapshot = false;
    },
    (/** @type {any} */ err) => {
      console.warn('[shared] live subscription lost:', err);
      store.noteBackendDegraded();
    },
  );

  return backend;
}

// ---------------------------------------------------------------------
// 2) Supabase (plain REST, no SDK)
// ---------------------------------------------------------------------

/** @param {typeof import('./store.js').store} store */
async function initSupabaseBackend(store) {
  const cfg = /** @type {{url: string, anonKey: string, pollMs?: number}} */ (SUPABASE);
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  // Accept the project URL with or without a pasted /rest/v1 suffix.
  const base = cfg.url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const pollMs = Math.max(1500, Number(cfg.pollMs) || 5000);

  /**
   * @param {string} path
   * @param {RequestInit & { timeoutMs?: number }} [init]
   */
  async function api(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @returns {Promise<import('./store.js').Task[]>} */
  async function fetchTasks() {
    const res = await api('/rest/v1/tasks?select=id,body');
    const rows = /** @type {{id: string, body: any}[]} */ (await res.json());
    /** @type {import('./store.js').Task[]} */
    const tasks = [];
    for (const row of rows) {
      const task = sanitizeTask(row.body);
      if (task) {
        task.id = row.id; // the row id is authoritative
        tasks.push(task);
      }
    }
    return tasks;
  }

  /** @param {import('./store.js').Task[]} tasks */
  async function upsertTasks(tasks) {
    await api('/rest/v1/tasks?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(tasks.map((t) => ({ id: t.id, body: taskBody(t) }))),
    });
  }

  // ----- reachability check + one-time seed ---------------------------
  let initialTasks;
  try {
    initialTasks = await fetchTasks();
  } catch (err) {
    console.warn('[shared] Supabase unreachable, staying local:', err);
    return null;
  }

  const localTasks = store.getTasks();
  if (initialTasks.length === 0 && localTasks.length > 0) {
    // Fresh shared table, existing per-browser tasks: migrate them once.
    // Upserts are idempotent, so two devices racing here is harmless.
    try {
      await upsertTasks(localTasks);
      const maxTicket = localTasks.reduce((m, t) => Math.max(m, t.ticketNumber + 1), FIRST_TICKET);
      await api('/rest/v1/rpc/next_ticket', {
        method: 'POST',
        body: JSON.stringify({ p_floor: maxTicket - 1 }),
      });
    } catch (err) {
      console.warn('[shared] seeding local tasks failed:', err);
    }
  }

  const local = makeLocalMarks();

  /**
   * Atomically claim the next ticket number via the next_ticket()
   * function from supabase-setup.sql (an UPDATE … RETURNING, so two
   * devices can never receive the same number).
   * @param {number} fallback
   */
  async function claimTicket(fallback) {
    try {
      const res = await api('/rest/v1/rpc/next_ticket', {
        method: 'POST',
        body: JSON.stringify({ p_floor: fallback }),
      });
      const value = Number(await res.json());
      if (Number.isInteger(value) && value >= FIRST_TICKET) return value;
    } catch {
      /* fall through to the provisional number */
    }
    return fallback;
  }

  /** @type {import('./store.js').Backend} */
  const backend = {
    kind: 'supabase',

    async createTask(task) {
      const ticketNumber = await claimTicket(task.ticketNumber);
      local.mark(task.id);
      await upsertTasks([{ ...task, ticketNumber }]);
      fetchNow();
    },

    async writeTask(task) {
      local.mark(task.id);
      await upsertTasks([task]);
      fetchNow();
    },

    async deleteTask(id) {
      local.mark(id);
      await api(`/rest/v1/tasks?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      fetchNow();
    },
  };

  // ----- polling sync --------------------------------------------------
  let firstSync = true;
  let syncing = false;

  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const tasks = await fetchTasks();
      /** @type {{type: 'added'|'modified'|'removed', id: string, task: import('./store.js').Task | null}[]} */
      const changes = [];
      if (!firstSync) {
        const prev = new Map(store.getTasks().map((t) => [t.id, t]));
        const next = new Map(tasks.map((t) => [t.id, t]));
        for (const [id, task] of next) {
          const before = prev.get(id);
          if (!before) changes.push({ type: 'added', id, task });
          else if (JSON.stringify(taskBody(before)) !== JSON.stringify(taskBody(task))) {
            changes.push({ type: 'modified', id, task });
          }
        }
        for (const [id, task] of prev) {
          if (!next.has(id)) changes.push({ type: 'removed', id, task });
        }
        if (changes.length === 0) return;
      }
      store.applyRemoteState(tasks, { firstSync, changes, isLocal: local.isLocal });
      firstSync = false;
      store.noteBackendRecovered();
    } catch (err) {
      console.warn('[shared] Supabase sync failed:', err);
      store.noteBackendDegraded();
    } finally {
      syncing = false;
    }
  }

  /** Nudge the loop right after this device writes. */
  function fetchNow() {
    setTimeout(sync, 60);
  }

  await sync(); // first sync before returning, so the UI starts shared

  window.setInterval(() => {
    if (!document.hidden) sync();
  }, pollMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  window.addEventListener('focus', sync);

  return backend;
}
