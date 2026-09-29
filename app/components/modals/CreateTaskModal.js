// @ts-check

/**
 * "Add Task" modal: title (required), notes, category (New / Medium / Hot)
 * and an optional assignee (Anyone / JG / IM / GG).
 */

import { store } from '../../store.js';
import { el, icon } from '../../dom.js';
import { createModal, modalHeader } from './modalBase.js';
import { taskFields } from './taskFields.js';

export function CreateTaskModal() {
  const modal = createModal({ label: 'Create task', className: 'modal-create' });
  const fields = taskFields('create');

  const form = el(
    'form',
    { class: 'modal-body', novalidate: true },
    ...fields.fields,
    el(
      'footer',
      { class: 'modal-foot' },
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus', 16), el('span', { text: 'Create Task' })),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fields.requireTitle()) return;
    store.createTask(fields.values());
    modal.close();
  });

  modal.dialog.append(modalHeader('Create Task', modal.close), form);

  return {
    open() {
      fields.fill();
      modal.open(fields.titleInput);
    },
  };
}
