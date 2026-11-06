import { describe, expect, it } from 'vitest';
import { groupByExercise, lastSetsByExercise, prefillSets } from '../training';
import { sortOpenTodos, isOverdue } from '../todos';
import type { Todo, Workout, WorkoutSet } from '../types';

const meta = { updatedAt: 1, deleted: 0 as const };
const w = (id: string, date: string, deleted: 0 | 1 = 0): Workout => ({ id, date, type: 'strength', durationMin: 60, source: 'manual', ...meta, deleted });
const s = (workoutId: string, exerciseId: string, order: number, reps: number, weightKg: number, warmup: 0 | 1 = 0): WorkoutSet => ({
  id: `${workoutId}-${order}`, workoutId, exerciseId, order, reps, weightKg, warmup, ...meta,
});

describe('Vorbelegung aus der letzten Einheit', () => {
  const workouts = [w('a', '2026-10-01'), w('b', '2026-10-08'), w('c', '2026-10-15', 1)];
  const sets = [
    s('a', 'bench', 0, 10, 60), s('a', 'bench', 1, 10, 60),
    s('b', 'bench', 0, 5, 40, 1), s('b', 'bench', 1, 8, 70), s('b', 'bench', 2, 7, 70),
    s('c', 'bench', 0, 5, 100), // gelöschte Einheit
    s('a', 'curl', 0, 12, 12),
  ];

  it('nimmt die jüngste nicht gelöschte Einheit und ignoriert Aufwärmsätze', () => {
    const h = lastSetsByExercise(workouts, sets);
    expect(h.get('bench')?.map((x) => [x.reps, x.weightKg])).toEqual([[8, 70], [7, 70]]);
    expect(h.get('curl')?.length).toBe(1);
  });

  it('beachtet beforeDate', () => {
    const h = lastSetsByExercise(workouts, sets, '2026-10-08');
    expect(h.get('bench')?.[0]?.weightKg).toBe(60);
  });

  it('prefillSets: Verlauf oder 3 × 10 als Start', () => {
    const p = prefillSets(['bench', 'new'], lastSetsByExercise(workouts, sets));
    expect(p.filter((x) => x.exerciseId === 'bench').map((x) => x.weightKg)).toEqual([70, 70]);
    expect(p.filter((x) => x.exerciseId === 'new')).toHaveLength(3);
    expect(new Set(p.map((x) => x.key)).size).toBe(p.length);
  });

  it('groupByExercise behält die Reihenfolge', () => {
    const g = groupByExercise([{ exerciseId: 'b' }, { exerciseId: 'a' }, { exerciseId: 'b' }]);
    expect(g.map(([id, xs]) => [id, xs.length])).toEqual([['b', 2], ['a', 1]]);
  });
});

describe('To-Dos', () => {
  const t = (title: string, priority: Todo['priority'], due?: string): Todo => ({ id: title, title, priority, due, category: 'Alltag', done: 0, ...meta });
  it('sortiert nach Fälligkeit, dann Priorität', () => {
    const sorted = sortOpenTodos([t('C', 'hoch'), t('B', 'niedrig', '2026-11-10'), t('A', 'mittel', '2026-11-07'), t('D', 'niedrig')]);
    expect(sorted.map((x) => x.title)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('erkennt überfällige Aufgaben', () => {
    expect(isOverdue(t('x', 'hoch', '2026-11-05'), '2026-11-06')).toBe(true);
    expect(isOverdue(t('x', 'hoch', '2026-11-06'), '2026-11-06')).toBe(false);
    expect(isOverdue({ ...t('x', 'hoch', '2026-11-01'), done: 1 }, '2026-11-06')).toBe(false);
  });
});
