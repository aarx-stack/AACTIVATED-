// @ts-check

/**
 * The task board: toolbar (search + Add Task), the six columns, and a
 * mobile floating Add button. Re-renders its columns from the store on
 * every data change; sorting is newest-first (Completed: most recently
 * completed first). Long columns show a short preview with a "Show more"
 * dropdown (see TaskColumn); which ones are open survives re-renders.
 */

import { COLUMNS, columnIdFor } from '../config.js';
import { store } from '../store.js';
import { el, icon, formatDayTime, formatTimeAgo, scrollIntoBox } from '../dom.js';
import { SearchBar, taskMatches } from './SearchBar.js';
import { TaskColumn } from './TaskColumn.js';

export class TaskBoard {
  /**
   * @param {{ onAddTask: () => void,
   *           onComplete: (task: any, origin: {x:number,y:number}) => void,
   *           onDelete: (task: any) => void,
   *           onEdit: (task: any) => void,
   *           onDropToComplete: (taskId: string) => void }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.query = '';
    /** @type {string | null} */
    this.highlightId = null;
    /** Cards whose notes the viewer expanded — kept across re-renders.
     * @type {Set<string>} */
    this.expandedNotes = new Set();
    /** Columns the viewer opened with "Show more".
     * @type {Set<string>} */
    this.expandedColumns = new Set();
    /** A task this viewer just created/moved/edited/completed: if it
     * lands in the hidden part of a column, that column opens.
     * @type {string | null} */
    this.revealId = null;

    this.search = SearchBar({
      onQuery: (q) => {
        this.query = q.trim().toLowerCase();
        this.renderColumns();
      },
    });

    this.addBtn = el(
      'button',
      { class: 'btn btn-primary btn-add', type: 'button', onclick: () => handlers.onAddTask() },
      icon('plus', 18),
      el('span', { text: 'Add Task' }),
    );

    this.grid = el('div', { class: 'board-grid' });
    this.countsEl = el('p', { class: 'board-subtitle' });

    this.el = el(
      'section',
      { class: 'board', 'aria-label': 'Task board' },
      el(
        'div',
        { class: 'board-toolbar' },
        el(
          'div',
          { class: 'board-heading' },
          el('h2', { class: 'board-title', text: 'The Court' }),
          this.countsEl,
        ),
        this.search.el,
        this.addBtn,
      ),
      this.grid,
    );

    // Floating Add button for small screens (the toolbar button hides there).
    this.fab = el(
      'button',
      {
        class: 'fab',
        type: 'button',
        'aria-label': 'Add task',
        title: 'Add task',
        onclick: () => handlers.onAddTask(),
      },
      icon('plus', 24),
    );
    document.body.appendChild(this.fab);

    store.subscribe((event) => {
      if (event.type === 'task-created' || event.type === 'task-completed') {
        this.highlightId = event.task?.id || null;
      }
      if (
        event.origin === 'local' &&
        ['task-created', 'task-moved', 'task-updated', 'task-completed'].includes(event.type)
      ) {
        this.revealId = event.task?.id || null;
      }
      if (
        [
          'task-created',
          'task-moved',
          'task-updated',
          'task-completed',
          'task-deleted',
          'task-locked',
          'task-unlocked',
          'sync',
        ].includes(event.type)
      ) {
        this.renderColumns();
      }
    });
    this.renderColumns();

    // Keep each card's "Created … · 3h 5m ago" current.
    window.setInterval(() => this.refreshAges(), 30_000);

    // Column widths change with the viewport, and with them which notes
    // are clamped — re-check (once per frame at most).
    let measurePending = false;
    window.addEventListener('resize', () => {
      if (measurePending) return;
      measurePending = true;
      requestAnimationFrame(() => {
        measurePending = false;
        this.measureNotes();
      });
    });
  }

  renderColumns() {
    const all = store.getTasks();
    const searching = this.query.length > 0;
    let matches = 0;

    // Open lists keep their scroll position through live re-renders.
    /** @type {Map<string, number>} */
    const scrollTops = new Map();
    for (const list of this.grid.querySelectorAll('.column-cards.is-expanded')) {
      scrollTops.set(list.getAttribute('data-col') || '', list.scrollTop);
    }
    let revealed = false;

    const columns = COLUMNS.map((col) => {
      let tasks = all.filter((t) => columnIdFor(t) === col.id && taskMatches(t, this.query));
      matches += tasks.length;
      // Newest first, so a collapsed column previews the latest cards.
      tasks =
        col.id === 'completed' || col.id === 'completed-orders'
          ? [...tasks].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
          : [...tasks].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      if (this.revealId && tasks.findIndex((t) => t.id === this.revealId) >= col.preview) {
        this.expandedColumns.add(col.id);
        revealed = true;
      }
      return TaskColumn(col, tasks, {
        onComplete: this.handlers.onComplete,
        onDelete: this.handlers.onDelete,
        onEdit: this.handlers.onEdit,
        onToggleNotes: (id, expanded) => {
          if (expanded) this.expandedNotes.add(id);
          else this.expandedNotes.delete(id);
        },
        expandedNotes: this.expandedNotes,
        expanded: this.expandedColumns.has(col.id),
        onToggleExpanded: (id, expanded) => {
          if (expanded) this.expandedColumns.add(id);
          else this.expandedColumns.delete(id);
          this.measureNotes(); // cards just shown haven't been measured
        },
        onDropToComplete: this.handlers.onDropToComplete,
        searching,
      });
    });
    this.grid.replaceChildren(...columns);
    this.measureNotes(); // first: "Show more" links change list heights
    for (const [id, top] of scrollTops) {
      const list = this.grid.querySelector(`.column-cards.is-expanded[data-col="${CSS.escape(id)}"]`);
      if (list) list.scrollTop = top;
    }

    if (revealed && this.revealId) {
      // Show it inside its now-open list; the page itself stays put.
      const card = this.grid.querySelector(`[data-task-id="${CSS.escape(this.revealId)}"]`);
      const list = card?.closest('.column-cards.is-expanded');
      if (card && list) scrollIntoBox(list, card);
    }
    this.revealId = null;

    // One-time glow on a card that just landed in a column.
    if (this.highlightId) {
      const cardEl = this.grid.querySelector(
        `[data-task-id="${CSS.escape(this.highlightId)}"]`,
      );
      if (cardEl) {
        cardEl.classList.add('is-arrived');
        window.setTimeout(() => cardEl.classList.remove('is-arrived'), 950);
      }
      this.highlightId = null;
    }

    const open = all.filter((t) => t.status !== 'completed').length;
    const done = all.length - open;
    this.countsEl.textContent = searching
      ? `${matches} match${matches === 1 ? '' : 'es'}`
      : `${open} open · ${done} completed`;
  }

  /** Update every card's created/sitting text in place (no re-render,
   * so focus, open menus and expanded notes are untouched). */
  refreshAges() {
    const now = new Date();
    for (const line of this.grid.querySelectorAll('.card-age')) {
      const when = line.querySelector('time.card-age-when');
      const iso = when?.getAttribute('datetime');
      if (!when || !iso) continue;
      when.textContent = formatDayTime(iso, now);
      const ago = line.querySelector('.card-age-ago');
      if (ago) ago.textContent = formatTimeAgo(iso, now.getTime());
    }
  }

  /** Offer "Show more" only on notes that are actually cut off. */
  measureNotes() {
    for (const notes of this.grid.querySelectorAll('.card-notes:not(.is-expanded)')) {
      const toggle = notes.nextElementSibling;
      if (toggle instanceof HTMLElement && toggle.classList.contains('card-notes-toggle')) {
        toggle.hidden = notes.scrollHeight <= notes.clientHeight + 1;
      }
    }
  }
}
