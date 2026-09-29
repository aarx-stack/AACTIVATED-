// @ts-check

/**
 * "Edit Task" popup, opened from the pencil icon on a card: change a
 * task's title, notes, category and assignee. Completion details (who
 * scored, when, time spent) stay locked, so an edit can never change the
 * scoreboard. Orders keep their own lane and completed tasks stay
 * completed, so neither offers the category picker.
 */

import { statusDef } from '../../config.js';
import { store } from '../../store.js';
import { el, icon, formatDuration } from '../../dom.js';
import { createModal, modalHeader, errorArea } from './modalBase.js';
import { taskFields } from './taskFields.js';

export function EditTaskModal() {
  const modal = createModal({ label: 'Edit task', className: 'modal-edit' });
  const fields = taskFields('edit', { notesRows: 7 });

  /** @type {string | null} */
  let taskId = null;

  const contextEl = el('p', { class: 'modal-context' });
  const lockedNote = el('p', { class: 'field-hint edit-locked-note', hidden: true });
  const error = errorArea();

  const form = el(
    'form',
    { class: 'modal-body', novalidate: true },
    contextEl,
    ...fields.fields,
    lockedNote,
    error.el,
    el(
      'footer',
      { class: 'modal-foot' },
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 16), el('span', { text: 'Save Changes' })),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!taskId || !fields.requireTitle()) return;
    const result = store.updateTask(taskId, fields.values());
    if (!result.ok) {
      error.show(
        result.reason === 'locked'
          ? 'This task is being completed right now — try again in a moment.'
          : 'This task no longer exists.',
      );
      return;
    }
    modal.close();
  });

  modal.dialog.append(modalHeader('Edit Task', modal.close), form);

  return {
    /** @param {import('../../store.js').Task} task */
    open(task) {
      taskId = task.id;
      const completed = task.status === 'completed';
      const order = task.kind === 'order';
      const kindLabel = order
        ? completed ? 'Completed order' : 'Store order'
        : completed ? 'Completed task' : `${statusDef(task.status).label} task`;
      contextEl.replaceChildren(
        el('span', { class: 'modal-context-ticket', text: `#${task.ticketNumber}` }),
        el('span', { class: 'modal-context-kind', text: kindLabel }),
      );
      fields.fill(task);
      fields.categoryField.hidden = completed || order;
      lockedNote.hidden = !completed;
      lockedNote.textContent = completed
        ? `Completed by ${task.completedBy || '—'}` +
          (task.timeSpentMinutes ? ` in ${formatDuration(task.timeSpentMinutes)}` : '') +
          ' — that stays as scored, so edits never change the scoreboard.'
        : '';
      error.clear();
      modal.open(fields.titleInput);
    },
  };
}
