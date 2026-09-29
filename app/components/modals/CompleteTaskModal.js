// @ts-check

/**
 * "Who completed this task?" — the only door into the Completed column.
 * Validates initials against the roster and how long the task took, locks
 * the task, then hands off to the ShotDirector, which commits the
 * completion when the ball drops.
 */

import { PLAYERS, normalizeInitials, isValidPlayer, playerListPhrase } from '../../config.js';
import { store } from '../../store.js';
import { shotDirector } from '../../shot.js';
import { el, parseDuration } from '../../dom.js';
import { createModal, modalHeader, errorArea } from './modalBase.js';

/** Quick-pick durations (label -> what lands in the input). */
const TIME_PRESETS = ['15m', '30m', '45m', '1h', '2h'];
/** Upper sanity bound: a week of minutes. */
const MAX_MINUTES = 7 * 24 * 60;

export function CompleteTaskModal() {
  const modal = createModal({ label: 'Complete task', className: 'modal-complete' });

  /** @type {import('../../store.js').Task | null} */
  let task = null;
  /** @type {{x: number, y: number} | null} */
  let fallbackOrigin = null;

  const contextEl = el('p', { class: 'modal-context' });
  // The task's full notes (order items, instructions…), so they can be
  // reviewed before completing. Scrolls when long.
  const notesText = el('div', {
    class: 'modal-notes-text',
    tabindex: '0',
    role: 'region',
    'aria-label': 'Task notes',
  });
  const notesBox = el(
    'div',
    { class: 'modal-notes', hidden: true },
    el('span', { class: 'field-label', text: 'Notes' }),
    notesText,
  );
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

  // --- how long did it take? -----------------------------------------
  const timeError = errorArea();
  const timeInput = /** @type {HTMLInputElement} */ (
    el('input', {
      class: 'field-input time-input',
      id: 'complete-time',
      type: 'text',
      placeholder: 'e.g. 45m or 1h 30m',
      maxlength: '12',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-describedby': 'complete-time-hint',
    })
  );

  const timePicks = el(
    'div',
    { class: 'quick-picks time-picks', role: 'group', 'aria-label': 'Quick durations' },
    ...TIME_PRESETS.map((label) =>
      el(
        'button',
        {
          class: 'quick-pick time-pick',
          type: 'button',
          'aria-label': `Time spent: ${label}`,
          onclick: () => {
            timeInput.value = label;
            timeError.clear();
            timeInput.removeAttribute('aria-invalid');
            syncTimePicks();
          },
        },
        el('span', { text: label }),
      ),
    ),
  );

  function syncTimePicks() {
    const current = timeInput.value.trim().toLowerCase();
    for (const btn of timePicks.querySelectorAll('.time-pick')) {
      btn.classList.toggle('is-selected', btn.textContent?.toLowerCase() === current);
    }
  }

  timeInput.addEventListener('input', () => {
    timeError.clear();
    timeInput.removeAttribute('aria-invalid');
    syncTimePicks();
  });

  const form = el(
    'form',
    { class: 'modal-body', novalidate: true },
    contextEl,
    notesBox,
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
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: 'complete-time', text: 'How long did it take?' }),
      timePicks,
      timeInput,
      el('p', {
        class: 'field-hint',
        id: 'complete-time-hint',
        text: 'Tap a duration or type your own — minutes and hours both work.',
      }),
      timeError.el,
    ),
    el(
      'footer',
      { class: 'modal-foot' },
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => modal.close() }),
      el(
        'button',
        { class: 'btn btn-success btn-shoot', type: 'submit' },
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
    const rawTime = timeInput.value.trim();
    if (!rawTime) {
      failTime('Please enter how long this task took.');
      return;
    }
    const timeSpentMinutes = parseDuration(rawTime);
    if (timeSpentMinutes === null || timeSpentMinutes < 1 || timeSpentMinutes > MAX_MINUTES) {
      failTime('Enter a time like 45m, 1h 30m, or 90.');
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
    shotDirector.enqueue({ taskId: task.id, initials, timeSpentMinutes, origin });
  });

  /** @param {string} message */
  function fail(message) {
    error.show(message);
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.select();
  }

  /** @param {string} message */
  function failTime(message) {
    timeError.show(message);
    timeInput.setAttribute('aria-invalid', 'true');
    timeInput.focus();
    timeInput.select();
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
      notesText.textContent = t.notes;
      notesText.scrollTop = 0;
      notesBox.hidden = !t.notes;
      /** @type {HTMLFormElement} */ (form).reset();
      error.clear();
      timeError.clear();
      input.removeAttribute('aria-invalid');
      timeInput.removeAttribute('aria-invalid');
      // Assigned tasks start with the assignee's initials filled in
      // (still editable — anyone can complete on their behalf).
      if (t.assignedTo && isValidPlayer(t.assignedTo)) input.value = t.assignedTo;
      syncPicks();
      syncTimePicks();
      modal.open(t.assignedTo && isValidPlayer(t.assignedTo) ? timeInput : input);
    },
  };
}
