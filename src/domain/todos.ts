import type { ISODate, Todo, TodoPriority } from './types';

const PRIO_RANK: Record<TodoPriority, number> = { hoch: 0, mittel: 1, niedrig: 2 };

/**
 * Sortierung offener Aufgaben: zuerst mit Fälligkeit (früheste zuerst),
 * dann ohne Fälligkeit; bei Gleichstand nach Priorität, dann Titel.
 */
export function sortOpenTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    const p = PRIO_RANK[a.priority] - PRIO_RANK[b.priority];
    return p !== 0 ? p : a.title.localeCompare(b.title, 'de');
  });
}

export function isOverdue(t: Todo, todayDate: ISODate): boolean {
  return t.done !== 1 && !!t.due && t.due < todayDate;
}
