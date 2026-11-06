import type { DailyVitals, Goals, ISODate, SleepNight, Workout } from './types';
import { dateRange, startOfWeek } from './dates';

export interface GoalProgress {
  key: 'strength' | 'mobility' | 'runs' | 'steps' | 'sleep';
  label: string;
  done: number;
  target: number;
  /** Optionales Ziel (z. B. Laufen): wird angezeigt, zählt aber nicht als verfehlt. */
  optional?: boolean;
}

/** Läufe = Ausdauer-Einheiten außer Gehen/Spazieren. */
export function isRun(w: Workout): boolean {
  return w.type === 'cardio' && !/geh|spazier|walk/i.test(w.label ?? '');
}

/**
 * Fortschritt der laufenden Woche (Montag bis `date`).
 * Schritte- und Schlafziel zählen Tage bzw. Nächte, an denen das Tagesziel erreicht wurde;
 * das Ziel ist die Zahl der Tage der ganzen Woche (7).
 */
export function weeklyGoals(
  date: ISODate,
  goals: Goals,
  data: { workouts: Workout[]; vitals: DailyVitals[]; nights: SleepNight[] },
): GoalProgress[] {
  const from = startOfWeek(date);
  const days = new Set(dateRange(from, date));
  const inWeek = <T extends { date: ISODate; deleted: 0 | 1 }>(rows: T[]) => rows.filter((r) => r.deleted !== 1 && days.has(r.date));
  const w = inWeek(data.workouts);
  const trainingDays = (pred: (x: Workout) => boolean) => new Set(w.filter(pred).map((x) => x.date)).size;

  return [
    { key: 'strength', label: 'Krafttraining', done: trainingDays((x) => x.type === 'strength'), target: goals.strengthPerWeek },
    { key: 'mobility', label: 'Mobility', done: trainingDays((x) => x.type === 'mobility'), target: goals.mobilityPerWeek },
    { key: 'runs', label: 'Laufen', done: trainingDays(isRun), target: goals.runsPerWeek, optional: true },
    {
      key: 'steps',
      label: `${goals.stepsPerDay.toLocaleString('de-DE')} Schritte`,
      done: inWeek(data.vitals).filter((v) => (v.steps ?? 0) >= goals.stepsPerDay).length,
      target: 7,
    },
    {
      key: 'sleep',
      label: `${goals.sleepHours.toLocaleString('de-DE')} h Schlaf`,
      done: inWeek(data.nights).filter((n) => n.asleepMin >= goals.sleepHours * 60).length,
      target: 7,
    },
  ];
}
