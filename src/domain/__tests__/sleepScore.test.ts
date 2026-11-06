import { describe, expect, it } from 'vitest';
import { bedtimeFromNoon, meanBedtimeFromNoon, sleepScore } from '../sleepScore';
import type { SleepNight } from '../types';

const n = (date: string, p: Partial<SleepNight> = {}): SleepNight => ({
  id: date, date, bedtime: '23:30', wakeTime: '07:30', asleepMin: 480, source: 'manual', updatedAt: 1, deleted: 0, ...p,
});

describe('bedtime um Mitternacht', () => {
  it('rechnet ab 12 Uhr, damit 23:30 und 00:30 nah beieinander liegen', () => {
    expect(bedtimeFromNoon('23:30')).toBe(690);
    expect(bedtimeFromNoon('00:30')).toBe(750);
    expect(meanBedtimeFromNoon([n('a', { bedtime: '23:30' }), n('b', { bedtime: '00:30' })])).toBe(720); // = 00:00
  });
});

describe('sleepScore', () => {
  it('nur Dauer bekannt: Ziel erreicht = 100, halbe Zeit = 50', () => {
    expect(sleepScore(n('2026-11-06'), 8).score).toBe(100);
    expect(sleepScore(n('2026-11-06', { asleepMin: 240 }), 8).score).toBe(50);
  });

  it('perfekte Nacht mit Phasen und Regelmäßigkeit = 100', () => {
    const prev = ['01', '02', '03'].map((d) => n(`2026-11-${d}`));
    const s = sleepScore(n('2026-11-06', { deepMin: 100, remMin: 100, awakeMin: 10 }), 8, prev);
    expect(s.components.map((c) => c.key)).toEqual(['duration', 'restorative', 'calm', 'regularity']);
    expect(s.score).toBe(100);
  });

  it('bewertet die einzelnen Teile linear', () => {
    const prev = ['01', '02', '03'].map((d) => n(`2026-11-${d}`, { bedtime: '23:00' }));
    // 6 h von 8 h, 30 % Tief+REM, 12,4 % wach, 45 min später als üblich
    const s = sleepScore(n('2026-11-06', { asleepMin: 360, deepMin: 50, remMin: 58, awakeMin: 51, bedtime: '23:45' }), 8, prev);
    const pts = Object.fromEntries(s.components.map((c) => [c.key, c.points]));
    expect(pts.duration).toBe(37.5);
    expect(pts.restorative).toBe(7.5);
    expect(pts.calm).toBe(7.6);
    expect(pts.regularity).toBe(10);
    expect(s.score).toBe(63);
  });

  it('Regelmäßigkeit erst ab 3 früheren Nächten', () => {
    const s = sleepScore(n('2026-11-06'), 8, [n('2026-11-05'), n('2026-11-04')]);
    expect(s.components.some((c) => c.key === 'regularity')).toBe(false);
  });
});
