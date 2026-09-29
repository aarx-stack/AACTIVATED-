// @ts-check

/**
 * One board column (Orders / New / Medium / Hot / Completed / Completed
 * Orders): header with live count, task list, empty state, and drop-zone
 * behavior. Dropping a task on either completed column never bypasses the
 * completion flow — it opens the initials popup instead. Orders can't be
 * moved into category columns; they live in their own lane until
 * completed.
 */

import { store } from '../store.js';
import { el, icon } from '../dom.js';
import { TaskCard } from './TaskCard.js';

/**
 * @param {import('../config.js').ColumnDef} col
 * @param {import('../store.js').Task[]} tasks   Already filtered + sorted.
 * @param {{ onComplete: Function, onDelete: Function, onEdit: Function,
 *           onToggleNotes: (taskId: string, expanded: boolean) => void,
 *           expandedNotes: Set<string>,
 *           onDropToComplete: (taskId: string) => void, searching: boolean }} opts
 */
export function TaskColumn(col, tasks, opts) {
  const count = tasks.length;

  const list = el(
    'div',
    { class: 'column-list' },
    ...tasks.map((t) =>
      TaskCard(
        t,
        {
          onComplete: /** @type {any} */ (opts.onComplete),
          onDelete: /** @type {any} */ (opts.onDelete),
          onEdit: /** @type {any} */ (opts.onEdit),
          onToggleNotes: opts.onToggleNotes,
        },
        { notesExpanded: opts.expandedNotes.has(t.id) },
      ),
    ),
  );

  if (count === 0) {
    list.append(
      el(
        'div',
        { class: 'column-empty' },
        el('span', { class: 'column-empty-icon' }, icon(col.icon, 20)),
        el('p', {
          class: 'column-empty-title',
          text: opts.searching ? 'No matching tasks' : 'No tasks here',
        }),
        el('p', {
          class: 'column-empty-hint',
          text: opts.searching ? 'Try a different search.' : col.emptyHint,
        }),
      ),
    );
  }

  const column = el(
    'section',
    {
      class: `board-column col-${col.id} tone-${col.tone}`,
      'aria-label': `${col.label} column, ${count} task${count === 1 ? '' : 's'}`,
    },
    el(
      'header',
      { class: 'column-head' },
      el('span', { class: 'column-icon' }, icon(col.icon, 15)),
      el('h2', { class: 'column-title', text: col.label.toUpperCase() }),
      el('span', { class: 'column-count', 'aria-hidden': 'true', text: String(count) }),
    ),
    list,
  );

  // ----- drop zone ------------------------------------------------------
  if (col.drop) {
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
      if (col.drop === 'complete') {
        // Completing always requires initials — open the flow instead.
        opts.onDropToComplete(taskId);
      } else {
        store.moveTask(taskId, /** @type {import('../config.js').StatusId} */ (col.id));
      }
    });
  }

  return column;
}
