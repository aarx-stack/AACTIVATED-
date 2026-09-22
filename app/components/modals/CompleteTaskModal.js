// @ts-check

/**
 * "Who completed this task?" — the only door into the Completed column.
 * Validates initials against the roster, locks the task, then hands off to
 * the ShotDirector, which commits the completion when the ball drops.
 */

import { PLAYERS, normalizeInitials, isValidPlayer, playerListPhrase } from '../../config.js';
import { store } from '../../store.js';
import { shotDirector } from '../../shot.js';
import { el } from '../../dom.js';
import { createModal, modalHeader, errorArea } from './modalBase.js';

export function CompleteTaskModal() {
  const modal = createModal({ label: 'Complete task', className: 'modal-complete' });

  /** @type {import('../../store.js').Task | null} */
  let task = null;
  /** @type {{x: number, y: number} | null} */
  let fallbackOrigin = null;

  const contextEl = el('p', { class: 'modal-context' });
  const error = errorArea();

  const input = /** @type {HTMLInputElement} */ (
    el('input', {
      class: 'field-input initials-input',
      id: 'complete-initials',
      type: 'text',
      placeholder: 'Enter initials',
      maxlength: '6',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      'aria-describedby': 'complete-initials-hint',
    })
  );

  const quickPicks = el(
    'div',
    { class: 'quick-picks', role: 'group', 'aria-label': 'Team members' },
    ...PLAYERS.map((p) =>
      el(
        'button',
        {
          class: 'quick-pick',
          type: 'button',
          'aria-label': `Use initials ${p.initials}`,
          onclick: () => {
            input.value = p.initials;
            error.clear();
            input.removeAttribute('aria-invalid');
            syncPicks();
            input.focus();
          },
        },
        el('span', { text: p.initials }),
      ),
    ),
  );

  function syncPicks() {
    const current = normalizeInitials(input.value);
    for (const btn of quickPicks.querySelectorAll('.quick-pick')) {
      btn.classList.toggle('is-selected', btn.textContent === current);
    }
  }

  const form = el(
    'form',
    { class: 'modal-body', novalidate: true },
    contextEl,
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: 'complete-initials', text: 'Who completed this task?' }),
      quickPicks,
      input,
      el('p', {
        class: 'field-hint',
        id: 'complete-initials-hint',
        text: `Tap a name or type initials (${PLAYERS.map((p) => p.initials).join(', ')}).`,
      }),
      error.el,
    ),
    el(
      'footer',
      { class: 'modal-foot' },
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => modal.close() }),
      el(
        'button',
        { class: 'btn btn-primary btn-shoot', type: 'submit' },
        el('span', { class: 'btn-ball', 'aria-hidden': 'true', text: '🏀' }),
        el('span', { text: 'Complete Task' }),
      ),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!task) return;
    const initials = normalizeInitials(input.value);

    if (!initials) {
      fail('Please enter initials.');
      return;
    }
    if (!isValidPlayer(initials)) {
      fail(`Please enter a valid team member: ${playerListPhrase()}.`);
      return;
    }
    const current = store.getTask(task.id);
    if (!current) {
      fail('This task no longer exists.');
      return;
    }
    if (current.status === 'completed') {
      fail('This task is already completed.');
      return;
    }
    // Lock before anything else so a double-submit can't queue two shots.
    if (!store.lockForCompletion(task.id)) {
      fail('This task is already being completed.');
      return;
    }

    const submitBtn = /** @type {HTMLElement | null} */ (form.querySelector('.btn-shoot'));
    const rect = submitBtn?.getBoundingClientRect();
    const origin = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : fallbackOrigin;

    modal.close();
    shotDirector.enqueue({ taskId: task.id, initials, origin });
  });

  /** @param {string} message */
  function fail(message) {
    error.show(message);
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.select();
  }

  input.addEventListener('input', () => {
    error.clear();
    input.removeAttribute('aria-invalid');
    syncPicks();
  });

  modal.dialog.append(modalHeader('Complete Task', modal.close), form);

  return {
    /**
     * @param {import('../../store.js').Task} t
     * @param {{x: number, y: number} | null} [origin] Launch point for the shot.
     */
    open(t, origin = null) {
      task = t;
      fallbackOrigin = origin;
      contextEl.replaceChildren(
        el('span', { class: 'modal-context-ticket', text: `#${t.ticketNumber}` }),
        el('span', { class: 'modal-context-title', text: t.title }),
      );
      /** @type {HTMLFormElement} */ (form).reset();
      error.clear();
      input.removeAttribute('aria-invalid');
      syncPicks();
      modal.open(input);
    },
  };
}
