import { describe, expect, it } from 'vitest';
import { isRun, weeklyGoals } from '../goals';
import { DEFAULT_SETTINGS } from '../../data/defaults';
import type { Workout } from '../types';

const meta = { updatedAt: 1, deleted: 0 as const };
const w = (date: string, type: Workout['type'], label?: string, deleted: 0 | 1 = 0): Workout => ({
  id: `${date}-${type}-${label}`, date, type, label, durationMin: 30, source: 'manual', ...meta, deleted,
});

describe('Wochenziele', () => {
  it('zählt nur die laufende Woche ab Montag und Trainingstage statt Einheiten', () => {
    const g = weeklyGoals('2026-11-06', DEFAULT_SETTINGS.goals, {
      workouts: [
        w('2026-11-01', 'strength'), // Sonntag Vorwoche
        w('2026-11-02', 'strength'),
        w('2026-11-02', 'strength'), // doppelt am selben Tag
        w('2026-11-03', 'strength'),
        w('2026-11-04', 'strength', undefined, 1), // gelöscht
        w('2026-11-04', 'mobility', 'Dehnen'),
        w('2026-11-05', 'cardio', 'Gehen'),
        w('2026-11-06', 'cardio', 'Laufen'),
      ],
      vitals: [
        { id: 'a', date: '2026-11-02', steps: 12000, source: 'manual', ...meta },
        { id: 'b', date: '2026-11-03', steps: 9999, source: 'manual', ...meta },
      ],
      nights: [{ id: 'n', date: '2026-11-03', bedtime: '23:00', wakeTime: '07:00', asleepMin: 480, source: 'manual', ...meta }],
    });
    const by = Object.fromEntries(g.map((x) => [x.key, [x.done, x.target]]));
    expect(by).toEqual({ strength: [2, 4], mobility: [1, 2], runs: [1, 1], steps: [1, 7], sleep: [1, 7] });
  });

  it('isRun schließt Gehen aus', () => {
    expect(isRun(w('2026-11-06', 'cardio', 'Laufen'))).toBe(true);
    expect(isRun(w('2026-11-06', 'cardio', 'Spaziergang'))).toBe(false);
    expect(isRun(w('2026-11-06', 'strength'))).toBe(false);
  });
});
