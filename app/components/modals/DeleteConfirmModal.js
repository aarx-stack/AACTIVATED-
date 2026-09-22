// @ts-check

/**
 * Destructive-action confirmation for deleting a task. Deleting a completed
 * task also removes its point — the modal says so, and the scoreboard
 * recalculates automatically because scores are derived from the tasks.
 */

import { store } from '../../store.js';
import { el, icon } from '../../dom.js';
import { createModal, modalHeader } from './modalBase.js';

export function DeleteConfirmModal() {
  const modal = createModal({ label: 'Delete task', className: 'modal-delete' });

  /** @type {import('../../store.js').Task | null} */
  let task = null;

  const bodyEl = el('div', { class: 'modal-body' });

  const confirmBtn = el(
    'button',
    { class: 'btn btn-danger', type: 'button' },
    icon('trash', 15),
    el('span', { text: 'Delete Task' }),
  );
  confirmBtn.addEventListener('click', () => {
    if (task) store.deleteTask(task.id);
    modal.close();
  });

  const cancelBtn = el('button', {
    class: 'btn btn-ghost',
    type: 'button',
    text: 'Cancel',
    onclick: () => modal.close(),
  });

  modal.dialog.append(
    modalHeader('Delete this task?', modal.close),
    bodyEl,
    el('footer', { class: 'modal-foot' }, cancelBtn, confirmBtn),
  );

  return {
    /** @param {import('../../store.js').Task} t */
    open(t) {
      task = t;
      const children = [
        el(
          'p',
          { class: 'modal-text' },
          'Are you sure you want to permanently delete ticket ',
          el('strong', { text: `#${t.ticketNumber}` }),
          '?',
        ),
        el('p', { class: 'modal-context' },
          el('span', { class: 'modal-context-ticket', text: `#${t.ticketNumber}` }),
          el('span', { class: 'modal-context-title', text: t.title }),
        ),
      ];
      if (t.status === 'completed' && t.completedBy) {
        children.push(
          el('p', {
            class: 'modal-note',
            text: `This also removes 1 point from ${t.completedBy} on the scoreboard.`,
          }),
        );
      }
      bodyEl.replaceChildren(...children);
      modal.open(cancelBtn);
    },
  };
}
