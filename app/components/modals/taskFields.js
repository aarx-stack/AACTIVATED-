// @ts-check

/**
 * The task form fields shared by the Add Task and Edit Task popups:
 * title (required), notes, category (New / Medium / Hot) and an optional
 * assignee (Anyone / JG / IM / GG / CG). Element ids carry a prefix, so both
 * popups can live in the page at once.
 */

import { ACTIVE_STATUSES, PLAYERS, statusDef } from '../../config.js';
import { el, icon } from '../../dom.js';
import { errorArea } from './modalBase.js';

/**
 * @typedef {Object} TaskFieldValues
 * @property {string} title
 * @property {string} notes
 * @property {import('../../config.js').StatusId} status
 * @property {string | null} assignedTo
 */

/**
 * @param {string} prefix  Id prefix, e.g. 'create' or 'edit'.
 * @param {{ notesRows?: number }} [opts]
 */
export function taskFields(prefix, { notesRows = 4 } = {}) {
  const titleInput = /** @type {HTMLInputElement} */ (
    el('input', {
      class: 'field-input',
      id: `${prefix}-title`,
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
      id: `${prefix}-notes`,
      placeholder: 'Add task notes...',
      rows: String(notesRows),
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
        name: `${prefix}-category`,
        id: `${prefix}-cat-${id}`,
        value: id,
        checked: id === 'new',
      })
    );
    radios.push(radio);
    categoryWrap.append(
      radio,
      el(
        'label',
        { class: `pill pill-${def.tone}`, for: `${prefix}-cat-${id}` },
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
    const id = `${prefix}-assignee-${opt.value || 'any'}`;
    const radio = /** @type {HTMLInputElement} */ (
      el('input', {
        class: 'pill-radio',
        type: 'radio',
        name: `${prefix}-assignee`,
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

  const categoryField = el(
    'div',
    { class: 'field' },
    el('span', { class: 'field-label', text: 'Category' }),
    categoryWrap,
  );

  const fields = [
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: `${prefix}-title`, text: 'Title' }),
      titleInput,
      titleError.el,
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: `${prefix}-notes` }, 'Notes ', el('span', { class: 'field-optional', text: '(optional)' })),
      notesInput,
    ),
    categoryField,
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field-label' }, 'Assign to ', el('span', { class: 'field-optional', text: '(optional)' })),
      assigneeWrap,
    ),
  ];

  titleInput.addEventListener('input', () => {
    titleError.clear();
    titleInput.removeAttribute('aria-invalid');
  });

  return {
    titleInput,
    categoryField,
    /** The four fields, in form order. */
    fields,

    /** @returns {TaskFieldValues} */
    values() {
      return {
        title: titleInput.value.trim(),
        notes: notesInput.value,
        status: /** @type {import('../../config.js').StatusId} */ (
          (radios.find((r) => r.checked) || radios[0]).value
        ),
        assignedTo: (assigneeRadios.find((r) => r.checked) || assigneeRadios[0]).value || null,
      };
    },

    /**
     * Load values into the fields (defaults: empty, New, Anyone).
     * @param {{ title?: string, notes?: string, status?: string, assignedTo?: string | null }} [v]
     */
    fill({ title = '', notes = '', status = 'new', assignedTo = null } = {}) {
      titleInput.value = title;
      notesInput.value = notes;
      radios.forEach((r) => (r.checked = r.value === status));
      if (!radios.some((r) => r.checked)) radios[0].checked = true;
      assigneeRadios.forEach((r) => (r.checked = r.value === (assignedTo || '')));
      if (!assigneeRadios.some((r) => r.checked)) assigneeRadios[0].checked = true;
      titleError.clear();
      titleInput.removeAttribute('aria-invalid');
    },

    /** Flag an empty title. Returns true when the title is filled in. */
    requireTitle() {
      if (titleInput.value.trim()) return true;
      titleError.show('Please enter a task title.');
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.focus();
      return false;
    },
  };
}
