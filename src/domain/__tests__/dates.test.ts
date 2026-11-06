import { describe, expect, it } from 'vitest';
import { addDays, dateRange, formatDuration, minutesBetween, minutesToHHMM, startOfWeek } from '../dates';

describe('dates', () => {
  it('addDays geht über Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('bleibt bei der Zeitumstellung auf dem richtigen Tag', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });
  it('Woche beginnt am Montag', () => {
    expect(startOfWeek('2026-11-06')).toBe('2026-11-02'); // Freitag
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02'); // Sonntag
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02'); // Montag
  });
  it('dateRange schließt beide Enden ein', () => {
    expect(dateRange('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });
  it('minutesBetween über Mitternacht', () => {
    expect(minutesBetween('23:30', '07:00')).toBe(450);
    expect(minutesBetween('03:15', '10:45')).toBe(450);
  });
  it('minutesToHHMM wickelt über 24 h', () => {
    expect(minutesToHHMM(1500)).toBe('01:00');
    expect(minutesToHHMM(-30)).toBe('23:30');
  });
  it('formatDuration', () => {
    expect(formatDuration(452)).toBe('7 h 32 min');
    expect(formatDuration(480)).toBe('8 h');
    expect(formatDuration(45)).toBe('45 min');
  });
});
