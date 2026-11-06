import { describe, expect, it } from 'vitest';
import { baseline, computeReadiness } from '../readiness';
import { DEFAULT_SETTINGS } from '../../data/defaults';
import type { Checkin, DailyVitals, SleepNight } from '../types';

const meta = { updatedAt: 1, deleted: 0 as const };
const t = DEFAULT_SETTINGS.readiness;
const date = '2026-11-06';
const night = (asleepMin: number): SleepNight => ({ id: 'n', date, bedtime: '23:00', wakeTime: '07:00', asleepMin, source: 'manual', ...meta });
const checkin = (recovery: number, soreness: number, kneePain = 0): Checkin => ({
  id: 'c', date, recovery, soreness, mood: 6, energy: 6, stress: 4, sleepQuality: 6, kneePain, tags: [], ...meta,
});
const history = (rhr: number, hrv: number, days = 10): DailyVitals[] =>
  Array.from({ length: days }, (_, i) => ({ id: `v${i}`, date: `2026-10-${String(27 + (i % 10)).padStart(2, '0')}`, restingHr: rhr, hrvSdnnMs: hrv, source: 'manual', ...meta }));
const todayV = (rhr: number, hrv: number): DailyVitals => ({ id: 'vt', date, restingHr: rhr, hrvSdnnMs: hrv, source: 'manual', ...meta });

const run = (p: { n?: SleepNight; c?: Checkin; v?: DailyVitals[]; includeKnee?: boolean }) =>
  computeReadiness({ date, night: p.n, checkin: p.c, vitals: p.v ?? [], sleepGoalHours: 8, t: { ...t, includeKnee: p.includeKnee ?? false } });

describe('Ampel', () => {
  it('ohne Schlaf und Check-in: unbekannt', () => {
    expect(run({}).status).toBe('unknown');
  });

  it('alles gut: grün', () => {
    const r = run({ n: night(470), c: checkin(8, 2), v: [...history(45, 80), todayV(45, 82)] });
    expect(r.status).toBe('green');
    expect(r.factors).toHaveLength(5);
    expect(r.missing).toEqual([]);
  });

  it('ein schlechter Faktor: gelb, mit Begründung', () => {
    const r = run({ n: night(330), c: checkin(8, 2) }); // 5,5 h = 69 % vom Ziel
    expect(r.status).toBe('yellow');
    expect(r.factors.find((f) => f.key === 'sleep')).toMatchObject({ level: 'bad', detail: '5 h 30 min, Ziel 8 h' });
  });

  it('zwei mittlere Faktoren: gelb', () => {
    expect(run({ n: night(420), c: checkin(5, 5) }).status).toBe('yellow'); // 87,5 % Schlaf, Erholung 5
  });

  it('zwei schlechte Faktoren: rot', () => {
    expect(run({ n: night(300), c: checkin(3, 2) }).status).toBe('red');
  });

  it('Ruhepuls und HRV gegen den eigenen Schnitt', () => {
    const r = run({ n: night(480), c: checkin(8, 2), v: [...history(45, 80), todayV(52, 60)] });
    expect(r.factors.find((f) => f.key === 'restingHr')?.level).toBe('bad'); // +7 bpm
    expect(r.factors.find((f) => f.key === 'hrv')?.level).toBe('bad'); // −25 %
    expect(r.status).toBe('red');
  });

  it('zu wenig Vergleichswerte: Ruhepuls/HRV fehlen statt falsch bewertet', () => {
    const r = run({ n: night(480), c: checkin(8, 2), v: [...history(45, 80, 3), todayV(60, 40)] });
    expect(r.missing).toEqual(['Ruhepuls', 'HRV']);
    expect(r.status).toBe('green');
  });

  it('Knie zählt nur, wenn eingeschaltet', () => {
    expect(run({ n: night(480), c: checkin(8, 2, 6) }).status).toBe('green');
    expect(run({ n: night(480), c: checkin(8, 2, 6), includeKnee: true }).status).toBe('yellow');
  });

  it('baseline braucht mindestens 5 Werte', () => {
    expect(baseline([1, 2, 3, 4])).toBeUndefined();
    expect(baseline([1, 2, 3, 4, 5, undefined])).toBe(3);
  });
});
