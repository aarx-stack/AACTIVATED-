// @ts-check

/**
 * A single task card. Clicking anywhere on an active card (or pressing
 * Enter on its stretched hit button) opens the completion popup — the
 * green Complete button lives there, next to the initials field, not on
 * the card face. Cards still offer Edit, Delete and move (drag, or an
 * accessible category menu on the status chip); completed cards show who
 * scored and when. Long notes are clamped with a Show more toggle. While
 * a card's completion shot is in flight it renders locked, so it can't be
 * completed, edited or deleted twice.
 */

import { ACTIVE_STATUSES, statusDef } from '../config.js';
import { store } from '../store.js';
import { el, icon, formatDateTime, formatDuration } from '../dom.js';

/**
 * @param {import('../store.js').Task} task
 * @param {{ onComplete: (task: any, origin: {x:number,y:number}) => void,
 *           onDelete: (task: any) => void,
 *           onEdit: (task: any) => void,
 *           onToggleNotes: (taskId: string, expanded: boolean) => void }} handlers
 * @param {{ notesExpanded?: boolean }} [view]
 */
export function TaskCard(task, handlers, { notesExpanded = false } = {}) {
  const def = statusDef(task.status);
  const locked = store.isLocked(task.id);
  const completed = task.status === 'completed';
  const tone = task.kind === 'order' ? (completed ? 'green' : 'cyan') : def.tone;

  const card = el('article', {
    class: `task-card tone-${tone}${completed ? ' is-completed' : ''}${locked ? ' is-shooting' : ''}`,
    'aria-label': `Ticket ${task.ticketNumber}: ${task.title}`,
    dataset: { taskId: task.id },
  });

  // --- header: ticket number + category/order chip --------------------
  const chip =
    task.kind === 'order'
      ? el(
          'span',
          { class: `status-chip ${completed ? 'tone-green' : 'tone-cyan'}` },
          icon(completed ? 'check' : 'cart', 12),
          el('span', { text: completed ? 'Completed' : 'Order' }),
        )
      : completed
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
      el(
        'span',
        { class: 'card-head-left' },
        el('span', { class: 'card-ticket', text: `#${task.ticketNumber}` }),
        task.assignedTo
          ? el(
              'span',
              { class: 'card-assignee', title: `Assigned to ${task.assignedTo}` },
              icon('user', 11),
              el('span', { text: task.assignedTo }),
            )
          : null,
      ),
      chip,
    ),
    el('h3', { class: 'card-title', text: task.title }),
  );

  if (task.notes) card.append(...notesBlock(task, notesExpanded, handlers.onToggleNotes));

  // --- footer: edit + delete ------------------------------------------
  const actions = el(
    'span',
    { class: 'card-actions' },
    el(
      'button',
      {
        class: 'icon-btn card-edit',
        type: 'button',
        'aria-label': `Edit task #${task.ticketNumber}`,
        title: 'Edit task',
        disabled: locked,
        onclick: () => handlers.onEdit(task),
      },
      icon('pencil', 15),
    ),
    el(
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
    ),
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
          el(
            'span',
            { class: 'card-completed-meta' },
            task.timeSpentMinutes
              ? el(
                  'span',
                  {
                    class: 'card-time',
                    title: 'Time spent',
                    'aria-label': `Time spent: ${formatDuration(task.timeSpentMinutes)}`,
                  },
                  icon('clock', 12),
                  el('span', { text: formatDuration(task.timeSpentMinutes) }),
                )
              : null,
            task.completedAt &&
              el('time', {
                class: 'card-completed-at',
                datetime: task.completedAt,
                text: formatDateTime(task.completedAt),
              }),
          ),
        ),
        actions,
      ),
    );
  } else {
    card.append(
      el(
        'footer',
        { class: 'card-foot' },
        el(
          'span',
          { class: `card-hint${locked ? ' is-shooting-hint' : ''}`, 'aria-hidden': 'true' },
          el('span', { class: 'card-hint-ball', text: '🏀' }),
          el('span', { text: locked ? 'SHOOTING…' : 'Click to complete' }),
        ),
        actions,
      ),
    );

    // Stretched hit target: the whole card opens the completion popup
    // (where the green Complete button lives). It sits under the edit and
    // delete buttons, the notes toggle and the category chip, which are
    // raised above it in CSS.
    const hit = el('button', {
      class: 'card-hit',
      type: 'button',
      disabled: locked,
      'aria-label': `Complete task #${task.ticketNumber}: ${task.title}`,
      onclick: (/** @type {MouseEvent} */ e) => {
        // Mouse clicks launch the shot from where you clicked; keyboard
        // activation (no coordinates) uses the card's center.
        const r = card.getBoundingClientRect();
        const origin =
          e.clientX || e.clientY
            ? { x: e.clientX, y: e.clientY }
            : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        handlers.onComplete(task, origin);
      },
    });
    card.append(hit);

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
 * Notes keep their line breaks and are clamped to a few lines on the card.
 * The Show more toggle stays hidden until the board measures that the
 * text actually overflows (TaskBoard.measureNotes); the expanded state is
 * remembered by the board so live re-renders don't collapse it.
 * @param {import('../store.js').Task} task
 * @param {boolean} expanded
 * @param {(taskId: string, expanded: boolean) => void} onToggle
 */
function notesBlock(task, expanded, onToggle) {
  const notes = el('p', {
    class: `card-notes${expanded ? ' is-expanded' : ''}`,
    id: `notes-${task.id.replace(/\s+/g, '-')}`,
    text: task.notes,
  });
  const label = el('span', { text: expanded ? 'Show less' : 'Show more' });
  const toggle = el(
    'button',
    {
      class: 'card-notes-toggle',
      type: 'button',
      hidden: !expanded,
      'aria-expanded': String(expanded),
      'aria-controls': notes.id,
      onclick: () => {
        const open = !notes.classList.contains('is-expanded');
        notes.classList.toggle('is-expanded', open);
        toggle.setAttribute('aria-expanded', String(open));
        label.textContent = open ? 'Show less' : 'Show more';
        onToggle(task.id, open);
      },
    },
    label,
    icon('chevronDown', 12),
  );
  return [notes, toggle];
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
