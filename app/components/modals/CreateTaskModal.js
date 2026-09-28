// @ts-check

/**
 * "Add Task" modal: title (required), notes, category (New / Medium / Hot)
 * and an optional assignee (Anyone / JG / IM / GG).
 */

import { ACTIVE_STATUSES, PLAYERS, statusDef } from '../../config.js';
import { store } from '../../store.js';
import { el, icon } from '../../dom.js';
import { createModal, modalHeader, errorArea } from './modalBase.js';

export function CreateTaskModal() {
  const modal = createModal({ label: 'Create task', className: 'modal-create' });

  const titleInput = /** @type {HTMLInputElement} */ (
    el('input', {
      class: 'field-input',
      id: 'create-title',
      type: 'text',
      placeholder: 'Enter task title...',
      maxlength: '120',
      autocomplete: 'off',
    })
  );
  const titleError = errorArea();

  const notesInput = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      class: 'field-input field-textarea',
      id: 'create-notes',
      placeholder: 'Add task notes...',
      rows: '4',
      maxlength: '2000',
    })
  );

  const categoryWrap = el('div', { class: 'pill-group', role: 'radiogroup', 'aria-label': 'Category' });
  /** @type {HTMLInputElement[]} */
  const radios = [];
  for (const id of ACTIVE_STATUSES) {
    const def = statusDef(id);
    const radio = /** @type {HTMLInputElement} */ (
      el('input', {
        class: 'pill-radio',
        type: 'radio',
        name: 'create-category',
        id: `create-cat-${id}`,
        value: id,
        checked: id === 'new',
      })
    );
    radios.push(radio);
    categoryWrap.append(
      radio,
      el(
        'label',
        { class: `pill pill-${def.tone}`, for: `create-cat-${id}` },
        icon(def.icon, 14),
        el('span', { text: def.label }),
      ),
    );
  }

  const assigneeWrap = el('div', { class: 'pill-group', role: 'radiogroup', 'aria-label': 'Assign to' });
  /** @type {HTMLInputElement[]} */
  const assigneeRadios = [];
  const assigneeOptions = [
    { value: '', label: 'Anyone', tone: 'neutral' },
    ...PLAYERS.map((p) => ({ value: p.initials, label: p.initials, tone: 'cyan' })),
  ];
  for (const opt of assigneeOptions) {
    const id = `create-assignee-${opt.value || 'any'}`;
    const radio = /** @type {HTMLInputElement} */ (
      el('input', {
        class: 'pill-radio',
        type: 'radio',
        name: 'create-assignee',
        id,
        value: opt.value,
        checked: opt.value === '',
      })
    );
    assigneeRadios.push(radio);
    assigneeWrap.append(
      radio,
      el(
        'label',
        { class: `pill pill-${opt.tone}`, for: id },
        opt.value ? icon('user', 13) : null,
        el('span', { text: opt.label }),
      ),
    );
  }

  const form = el(
    'form',
    { class: 'modal-body', novalidate: true },
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: 'create-title', text: 'Title' }),
      titleInput,
      titleError.el,
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: 'create-notes' }, 'Notes ', el('span', { class: 'field-optional', text: '(optional)' })),
      notesInput,
    ),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field-label', text: 'Category' }),
      categoryWrap,
    ),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field-label' }, 'Assign to ', el('span', { class: 'field-optional', text: '(optional)' })),
      assigneeWrap,
    ),
    el(
      'footer',
      { class: 'modal-foot' },
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus', 16), el('span', { text: 'Create Task' })),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      titleError.show('Please enter a task title.');
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.focus();
      return;
    }
    const status = /** @type {import('../../config.js').StatusId} */ (
      (radios.find((r) => r.checked) || radios[0]).value
    );
    const assignedTo = (assigneeRadios.find((r) => r.checked) || assigneeRadios[0]).value || null;
    store.createTask({ title, notes: notesInput.value, status, assignedTo });
    modal.close();
  });

  titleInput.addEventListener('input', () => {
    titleError.clear();
    titleInput.removeAttribute('aria-invalid');
  });

  modal.dialog.append(modalHeader('Create Task', modal.close), form);

  return {
    open() {
      /** @type {HTMLFormElement} */ (form).reset();
      radios.forEach((r) => (r.checked = r.value === 'new'));
      assigneeRadios.forEach((r) => (r.checked = r.value === ''));
      titleError.clear();
      titleInput.removeAttribute('aria-invalid');
      modal.open(titleInput);
    },
  };
}
