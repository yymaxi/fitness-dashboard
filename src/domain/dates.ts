import type { HHMM, ISODate } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Lokales Datum als YYYY-MM-DD (keine UTC-Verschiebung). */
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = fromISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Montag der Woche, in der `s` liegt. */
export function startOfWeek(s: ISODate): ISODate {
  const d = fromISODate(s);
  const offset = (d.getDay() + 6) % 7; // Mo = 0 … So = 6
  return addDays(s, -offset);
}

/** Alle Tage von `from` bis einschließlich `to`. */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function hhmmToMinutes(t: HHMM): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHHMM(min: number): HHMM {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Zeit im Bett zwischen zwei Uhrzeiten, auch über Mitternacht. */
export function minutesBetween(start: HHMM, end: HHMM): number {
  const diff = hhmmToMinutes(end) - hhmmToMinutes(start);
  return diff <= 0 ? diff + 1440 : diff;
}

/** 452 → „7 h 32 min“ */
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
export function formatDate(s: ISODate): string {
  return weekdayFmt.format(fromISODate(s));
}
