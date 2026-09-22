// @ts-check

/**
 * Minimal live search: filters by ticket number, title, notes or initials.
 */

import { el, icon } from '../dom.js';

/** @param {{ onQuery: (q: string) => void }} opts */
export function SearchBar({ onQuery }) {
  const input = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Search tickets, titles, notes, initials…',
    'aria-label': 'Search tasks',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const clearBtn = el(
    'button',
    {
      class: 'icon-btn search-clear',
      type: 'button',
      'aria-label': 'Clear search',
      hidden: true,
      onclick: () => {
        /** @type {HTMLInputElement} */ (input).value = '';
        update();
        input.focus();
      },
    },
    icon('x', 14),
  );

  function update() {
    const q = /** @type {HTMLInputElement} */ (input).value;
    clearBtn.hidden = q.length === 0;
    onQuery(q);
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (/** @type {KeyboardEvent} */ (e).key === 'Escape') {
      /** @type {HTMLInputElement} */ (input).value = '';
      update();
    }
  });

  const root = el(
    'div',
    { class: 'search-bar', role: 'search' },
    el('span', { class: 'search-icon' }, icon('search', 16)),
    input,
    clearBtn,
  );
  return { el: root, input: /** @type {HTMLInputElement} */ (input) };
}

/**
 * Does a task match the query? Checks ticket number (with or without '#'),
 * title, notes and the completing player's initials.
 * @param {import('../store.js').Task} task
 * @param {string} query Normalized (trimmed, lowercase) query.
 */
export function taskMatches(task, query) {
  if (!query) return true;
  const haystack = [
    `#${task.ticketNumber}`,
    String(task.ticketNumber),
    task.title,
    task.notes,
    task.completedBy || '',
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}
