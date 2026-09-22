// @ts-check

/**
 * Shared behavior for the app's modals, built on native <dialog>:
 * focus is moved into the dialog on open and restored on close, Escape
 * cancels, and clicking the backdrop closes.
 */

import { el, icon } from '../../dom.js';

/**
 * @param {{ label: string, className?: string }} opts
 */
export function createModal({ label, className = '' }) {
  const dialog = /** @type {HTMLDialogElement} */ (
    el('dialog', { class: `modal ${className}`.trim(), 'aria-label': label })
  );
  document.body.appendChild(dialog);

  /** @type {HTMLElement | null} */
  let opener = null;

  function open(/** @type {HTMLElement | null} */ initialFocus = null) {
    opener = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!dialog.open) dialog.showModal();
    (initialFocus || /** @type {HTMLElement | null} */ (dialog.querySelector('input, textarea, button')))?.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  });

  // Click on the backdrop (the dialog element itself, outside its content).
  dialog.addEventListener('mousedown', (e) => {
    if (e.target === dialog) close();
  });

  return { dialog, open, close };
}

/**
 * Standard modal header with title + close button.
 * @param {string} title
 * @param {() => void} onClose
 * @param {string} [id]
 */
export function modalHeader(title, onClose, id) {
  return el(
    'header',
    { class: 'modal-head' },
    el('h2', { class: 'modal-title', text: title, id: id || null }),
    el(
      'button',
      { class: 'icon-btn modal-close', type: 'button', 'aria-label': 'Close dialog', onclick: onClose },
      icon('x', 16),
    ),
  );
}

/**
 * Inline validation message area (polite live region).
 */
export function errorArea() {
  const node = el('p', { class: 'field-error', role: 'alert', hidden: true });
  return {
    el: node,
    /** @param {string} message */
    show(message) {
      node.textContent = message;
      node.hidden = false;
    },
    clear() {
      node.textContent = '';
      node.hidden = true;
    },
  };
}
