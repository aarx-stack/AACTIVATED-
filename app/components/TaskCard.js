// @ts-check

/**
 * A single task card. Active cards offer Complete / Delete / move (drag, or
 * an accessible category menu on the status chip); completed cards show who
 * scored and when. While a card's completion shot is in flight it renders
 * locked, so it can't be completed or deleted twice.
 */

import { ACTIVE_STATUSES, statusDef } from '../config.js';
import { store } from '../store.js';
import { el, icon, formatDateTime } from '../dom.js';

/**
 * @param {import('../store.js').Task} task
 * @param {{ onComplete: (task: any, origin: {x:number,y:number}) => void,
 *           onDelete: (task: any) => void }} handlers
 */
export function TaskCard(task, handlers) {
  const def = statusDef(task.status);
  const locked = store.isLocked(task.id);
  const completed = task.status === 'completed';

  const card = el('article', {
    class: `task-card tone-${def.tone}${completed ? ' is-completed' : ''}${locked ? ' is-shooting' : ''}`,
    'aria-label': `Ticket ${task.ticketNumber}: ${task.title}`,
    dataset: { taskId: task.id },
  });

  // --- header: ticket number + category chip -------------------------
  const chip = completed
    ? el(
        'span',
        { class: `status-chip tone-${def.tone}` },
        icon(def.icon, 12),
        el('span', { text: def.label }),
      )
    : categoryChipMenu(task, locked);

  card.append(
    el(
      'header',
      { class: 'card-head' },
      el('span', { class: 'card-ticket', text: `#${task.ticketNumber}` }),
      chip,
    ),
    el('h3', { class: 'card-title', text: task.title }),
  );

  if (task.notes) card.append(el('p', { class: 'card-notes', text: task.notes }));

  // --- footer ---------------------------------------------------------
  const deleteBtn = el(
    'button',
    {
      class: 'icon-btn card-delete',
      type: 'button',
      'aria-label': `Delete task #${task.ticketNumber}`,
      title: 'Delete task',
      disabled: locked,
      onclick: () => handlers.onDelete(task),
    },
    icon('trash', 16),
  );

  if (completed) {
    card.append(
      el(
        'footer',
        { class: 'card-foot card-foot-completed' },
        el(
          'div',
          { class: 'card-completed-info' },
          el(
            'span',
            { class: 'card-completed-by' },
            icon('check', 14),
            el('span', {}, 'Completed by ', el('strong', { text: task.completedBy || '—' })),
          ),
          task.completedAt &&
            el('time', {
              class: 'card-completed-at',
              datetime: task.completedAt,
              text: formatDateTime(task.completedAt),
            }),
        ),
        deleteBtn,
      ),
    );
  } else {
    const completeBtn = el(
      'button',
      {
        class: 'btn btn-complete',
        type: 'button',
        disabled: locked,
        onclick: (/** @type {MouseEvent} */ e) => {
          const r = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
          handlers.onComplete(task, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        },
      },
      icon('check', 15),
      el('span', { text: locked ? 'SHOOTING…' : 'COMPLETE' }),
    );
    card.append(el('footer', { class: 'card-foot' }, completeBtn, deleteBtn));

    // Drag between active columns (dropping on Completed opens the
    // initials flow — see TaskColumn).
    if (!locked) {
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    }
  }

  return card;
}

/**
 * The category chip doubles as an accessible "move to…" menu, so tasks can
 * change columns without drag-and-drop (keyboard & touch friendly).
 * @param {import('../store.js').Task} task
 * @param {boolean} locked
 */
function categoryChipMenu(task, locked) {
  const def = statusDef(task.status);
  const wrap = el('span', { class: 'chip-menu-wrap' });
  const btn = el(
    'button',
    {
      class: `status-chip status-chip-btn tone-${def.tone}`,
      type: 'button',
      disabled: locked,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      title: 'Move to another column',
      'aria-label': `Category ${def.label}. Move task #${task.ticketNumber} to another column`,
    },
    icon(def.icon, 12),
    el('span', { text: def.label }),
  );
  wrap.append(btn);

  /** @type {HTMLElement | null} */
  let menu = null;
  const close = (refocus = false) => {
    if (!menu) return;
    menu.remove();
    menu = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (refocus) btn.focus();
  };
  const onOutside = (/** @type {Event} */ e) => {
    if (menu && !wrap.contains(/** @type {Node} */ (e.target))) close();
  };
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    }
  };

  btn.addEventListener('click', () => {
    if (menu) {
      close(true);
      return;
    }
    menu = el(
      'div',
      { class: 'chip-menu', role: 'menu', 'aria-label': 'Move task to column' },
      ...ACTIVE_STATUSES.map((id) => {
        const target = statusDef(id);
        const current = id === task.status;
        return el(
          'button',
          {
            class: `chip-menu-item tone-${target.tone}${current ? ' is-current' : ''}`,
            type: 'button',
            role: 'menuitem',
            'aria-disabled': String(current),
            onclick: () => {
              close();
              if (!current) store.moveTask(task.id, target.id);
            },
          },
          icon(target.icon, 13),
          el('span', { text: target.label }),
          current ? el('span', { class: 'chip-menu-current', text: 'current' }) : null,
        );
      }),
    );
    wrap.append(menu);
    btn.setAttribute('aria-expanded', 'true');
    const first = /** @type {HTMLElement | null} */ (menu.querySelector('button:not(.is-current)'));
    (first || menu.querySelector('button'))?.focus();
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });

  return wrap;
}
