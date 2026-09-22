// @ts-check

/**
 * App bootstrap: mounts the scoreboard and board, wires the modals, and
 * handles a couple of quality-of-life keyboard shortcuts.
 */

import { store } from './store.js';
import { el } from './dom.js';
import { Scoreboard } from './components/Scoreboard.js';
import { TaskBoard } from './components/TaskBoard.js';
import { CreateTaskModal } from './components/modals/CreateTaskModal.js';
import { CompleteTaskModal } from './components/modals/CompleteTaskModal.js';
import { DeleteConfirmModal } from './components/modals/DeleteConfirmModal.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app mount point');

const createModal = CreateTaskModal();
const completeModal = CompleteTaskModal();
const deleteModal = DeleteConfirmModal();

const scoreboard = new Scoreboard();
const board = new TaskBoard({
  onAddTask: () => createModal.open(),
  onComplete: (task, origin) => completeModal.open(task, origin),
  onDelete: (task) => deleteModal.open(task),
  onDropToComplete: (taskId) => {
    const task = store.getTask(taskId);
    if (task && task.status !== 'completed' && !store.isLocked(taskId)) {
      completeModal.open(task);
    }
  },
});

// Shown only if localStorage is unavailable (e.g. blocked storage).
const storageBanner = el('p', {
  class: 'storage-banner',
  role: 'alert',
  hidden: true,
  text: 'Heads up: browser storage is unavailable, so changes will be lost on refresh.',
});
store.subscribe((event) => {
  if (event.type === 'storage-status') storageBanner.hidden = store.storageOk;
});

root.append(
  scoreboard.el,
  storageBanner,
  board.el,
  el('footer', { class: 'app-footer' },
    el('span', { text: 'Task Scoreboard' }),
    el('span', { class: 'app-footer-sep', 'aria-hidden': 'true', text: '·' }),
    el('span', { text: 'Data is saved in this browser' }),
  ),
);

// Trigger a save probe so a storage problem surfaces immediately on load.
store.save();
storageBanner.hidden = store.storageOk;

// Keyboard shortcuts: "/" focuses search, "n" opens Add Task —
// ignored while typing or while a dialog is open.
document.addEventListener('keydown', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable;
  const dialogOpen = Boolean(document.querySelector('dialog[open]'));
  if (typing || dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    board.search.input.focus();
  } else if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    createModal.open();
  }
});
