// @ts-check

/**
 * One board column (New / Medium / Hot / Completed): header with live
 * count, task list, empty state, and drop-zone behavior. Dropping a task
 * on Completed never bypasses the completion flow — it opens the initials
 * modal instead.
 */

import { ACTIVE_STATUSES } from '../config.js';
import { store } from '../store.js';
import { el, icon } from '../dom.js';
import { TaskCard } from './TaskCard.js';

/**
 * @param {import('../config.js').StatusDef} def
 * @param {import('../store.js').Task[]} tasks   Already filtered + sorted.
 * @param {{ onComplete: Function, onDelete: Function,
 *           onDropToComplete: (taskId: string) => void, searching: boolean }} opts
 */
export function TaskColumn(def, tasks, opts) {
  const isCompletedCol = def.id === 'completed';
  const count = tasks.length;

  const list = el(
    'div',
    { class: 'column-list' },
    ...tasks.map((t) =>
      TaskCard(t, {
        onComplete: /** @type {any} */ (opts.onComplete),
        onDelete: /** @type {any} */ (opts.onDelete),
      }),
    ),
  );

  if (count === 0) {
    list.append(
      el(
        'div',
        { class: 'column-empty' },
        el('span', { class: 'column-empty-icon' }, icon(def.icon, 20)),
        el('p', {
          class: 'column-empty-title',
          text: opts.searching ? 'No matching tasks' : 'No tasks here',
        }),
        el('p', {
          class: 'column-empty-hint',
          text: opts.searching
            ? 'Try a different search.'
            : isCompletedCol
              ? 'Completed tasks land here after a made shot.'
              : 'You can add a task using the + button.',
        }),
      ),
    );
  }

  const column = el(
    'section',
    {
      class: `board-column col-${def.id} tone-${def.tone}`,
      'aria-label': `${def.label} column, ${count} task${count === 1 ? '' : 's'}`,
    },
    el(
      'header',
      { class: 'column-head' },
      el('span', { class: 'column-icon' }, icon(def.icon, 15)),
      el('h2', { class: 'column-title', text: def.label.toUpperCase() }),
      el('span', { class: 'column-count', 'aria-hidden': 'true', text: String(count) }),
    ),
    list,
  );

  // ----- drop zone ------------------------------------------------------
  let dragDepth = 0;
  column.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('text/task-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  column.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('text/task-id')) return;
    dragDepth += 1;
    column.classList.add('is-drop-target');
  });
  column.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) column.classList.remove('is-drop-target');
  });
  column.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    column.classList.remove('is-drop-target');
    const taskId = e.dataTransfer?.getData('text/task-id');
    if (!taskId) return;
    if (isCompletedCol) {
      // Completing always requires initials — open the flow instead.
      opts.onDropToComplete(taskId);
    } else if (ACTIVE_STATUSES.includes(def.id)) {
      store.moveTask(taskId, def.id);
    }
  });

  return column;
}
