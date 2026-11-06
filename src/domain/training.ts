import type { Workout, WorkoutSet, WorkoutType } from './types';

export const WORKOUT_TYPE_LABEL: Record<WorkoutType, string> = {
  strength: 'Kraft',
  cardio: 'Ausdauer',
  mobility: 'Mobility',
  other: 'Sonstiges',
};

export interface SetDraft {
  key: string;
  exerciseId: string;
  reps: number;
  weightKg: number;
}

/**
 * Sätze der letzten Einheit je Übung (für die Vorbelegung).
 * Ergebnis: exerciseId → Sätze der jüngsten Einheit, in der die Übung vorkam.
 */
export function lastSetsByExercise(workouts: Workout[], sets: WorkoutSet[], beforeDate?: string): Map<string, WorkoutSet[]> {
  const dateOf = new Map(
    workouts.filter((w) => w.deleted !== 1 && (!beforeDate || w.date < beforeDate)).map((w) => [w.id, w.date]),
  );
  const best = new Map<string, { date: string; workoutId: string }>();
  for (const s of sets) {
    if (s.deleted === 1 || s.warmup === 1) continue;
    const d = dateOf.get(s.workoutId);
    if (!d) continue;
    const cur = best.get(s.exerciseId);
    if (!cur || d > cur.date) best.set(s.exerciseId, { date: d, workoutId: s.workoutId });
  }
  const out = new Map<string, WorkoutSet[]>();
  for (const [exerciseId, { workoutId }] of best) {
    out.set(
      exerciseId,
      sets.filter((s) => s.workoutId === workoutId && s.exerciseId === exerciseId && s.deleted !== 1 && s.warmup !== 1).sort((a, b) => a.order - b.order),
    );
  }
  return out;
}

let keySeq = 0;
export const nextKey = () => `k${++keySeq}`;

/** Sätze für eine Vorlage: Werte der letzten Einheit, sonst 3 × 10 ohne Gewicht. */
export function prefillSets(exerciseIds: string[], history: Map<string, WorkoutSet[]>, defaultSets = 3): SetDraft[] {
  return exerciseIds.flatMap((exerciseId) => {
    const last = history.get(exerciseId);
    if (last && last.length > 0) {
      return last.map((s) => ({ key: nextKey(), exerciseId, reps: s.reps, weightKg: s.weightKg }));
    }
    return Array.from({ length: defaultSets }, () => ({ key: nextKey(), exerciseId, reps: 10, weightKg: 0 }));
  });
}

/** Gruppiert Sätze in Reihenfolge des ersten Auftretens der Übung. */
export function groupByExercise<T extends { exerciseId: string }>(sets: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const s of sets) {
    const g = groups.get(s.exerciseId);
    if (g) g.push(s);
    else groups.set(s.exerciseId, [s]);
  }
  return [...groups];
}
