import { describe, expect, it } from 'vitest';
import { checkinDefaults, clampScale } from '../checkin';
import type { Checkin, SleepNight } from '../types';

const meta = { updatedAt: 1, deleted: 0 as const };
const prev: Checkin = {
  id: 'ci-2026-11-05', date: '2026-11-05', recovery: 8, soreness: 2, mood: 7, energy: 7, stress: 3,
  sleepQuality: 8, kneePain: 2, tags: ['Alkohol'], note: 'gestern', ...meta,
};
const night = (date: string, bedtime: string): SleepNight => ({
  id: `sl-${date}`, date, bedtime, wakeTime: '07:30', asleepMin: 420, source: 'manual', ...meta,
});

describe('checkinDefaults', () => {
  it('übernimmt Skalen vom Vortag, aber keine Tags/Notiz', () => {
    const d = checkinDefaults('2026-11-06', { previous: prev, trackKnee: true });
    expect(d.recovery).toBe(8);
    expect(d.kneePain).toBe(2);
    expect(d.tags).toEqual([]);
    expect(d.note).toBe('');
  });
  it('lädt einen bestehenden Check-in vollständig', () => {
    const d = checkinDefaults('2026-11-05', { existing: prev, trackKnee: true });
    expect(d.tags).toEqual(['Alkohol']);
    expect(d.note).toBe('gestern');
  });
  it('bevorzugt die (importierte) Nacht des Tages für Schlafzeiten', () => {
    const d = checkinDefaults('2026-11-06', {
      nightToday: night('2026-11-06', '00:15'), lastNight: night('2026-11-05', '23:00'), trackKnee: false,
    });
    expect(d.bedtime).toBe('00:15');
    expect(d.kneePain).toBeUndefined();
  });
  it('nutzt neutrale Werte ohne Vorgeschichte', () => {
    const d = checkinDefaults('2026-11-06', { trackKnee: false });
    expect(d).toMatchObject({ bedtime: '23:00', wakeTime: '07:00', recovery: 6, stress: 4 });
  });
});

describe('clampScale', () => {
  it('rundet und begrenzt', () => {
    expect(clampScale(11.4)).toBe(10);
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(-1, 0, 10)).toBe(0);
    expect(clampScale(6.5)).toBe(7);
  });
});
