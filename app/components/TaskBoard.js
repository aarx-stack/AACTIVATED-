// @ts-check

/**
 * The task board: toolbar (search + Add Task), the four columns, and a
 * mobile floating Add button. Re-renders its columns from the store on
 * every data change; sorting is newest-first (Completed: most recently
 * completed first).
 */

import { STATUSES } from '../config.js';
import { store } from '../store.js';
import { el, icon } from '../dom.js';
import { SearchBar, taskMatches } from './SearchBar.js';
import { TaskColumn } from './TaskColumn.js';

export class TaskBoard {
  /**
   * @param {{ onAddTask: () => void,
   *           onComplete: (task: any, origin: {x:number,y:number}) => void,
   *           onDelete: (task: any) => void,
   *           onDropToComplete: (taskId: string) => void }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.query = '';
    /** @type {string | null} */
    this.highlightId = null;

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
        ['task-created', 'task-moved', 'task-completed', 'task-deleted', 'task-locked', 'task-unlocked', 'sync'].includes(
          event.type,
        )
      ) {
        this.renderColumns();
      }
    });
    this.renderColumns();
  }

  renderColumns() {
    const all = store.getTasks();
    const searching = this.query.length > 0;
    let matches = 0;
    const columns = STATUSES.map((def) => {
      let tasks = all.filter((t) => t.status === def.id && taskMatches(t, this.query));
      matches += tasks.length;
      if (def.id === 'completed') {
        tasks = [...tasks].sort(
          (a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''),
        );
      }
      return TaskColumn(def, tasks, {
        onComplete: this.handlers.onComplete,
        onDelete: this.handlers.onDelete,
        onDropToComplete: this.handlers.onDropToComplete,
        searching,
      });
    });
    this.grid.replaceChildren(...columns);

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
}
