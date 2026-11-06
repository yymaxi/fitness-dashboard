import type { SleepNight } from './types';
import { hhmmToMinutes } from './dates';

/**
 * Schlaf-Score 0–100, transparent aus bis zu vier Teilen:
 *
 * | Teil          | Gewicht | volle Punkte                          | 0 Punkte                 |
 * |---------------|---------|---------------------------------------|--------------------------|
 * | Dauer         | 50      | Schlafzeit ≥ Ziel                     | 0 min (linear)           |
 * | Erholsamkeit  | 15      | Tief + REM ≥ 40 % der Schlafzeit      | ≤ 20 %                   |
 * | Ruhe          | 15      | Wachanteil ≤ 5 % der Zeit im Bett     | ≥ 20 %                   |
 * | Regelmäßigkeit| 20      | Einschlafen = eigener 14-Tage-Schnitt | ≥ 90 min Abweichung      |
 *
 * Fehlen Daten für einen Teil (z. B. keine Phasen bei manueller Eingabe),
 * wird er weggelassen und die übrigen Teile werden auf 100 hochgerechnet.
 */
export interface SleepScoreComponent {
  key: 'duration' | 'restorative' | 'calm' | 'regularity';
  label: string;
  points: number;
  max: number;
}

export interface SleepScore {
  score: number;
  components: SleepScoreComponent[];
}

const lerp01 = (v: number, zero: number, full: number) => Math.min(1, Math.max(0, (v - zero) / (full - zero)));

/** Einschlafzeit als Minuten ab 12:00 Uhr, damit Zeiten um Mitternacht sinnvoll gemittelt werden. */
export function bedtimeFromNoon(hhmm: string): number {
  const m = hhmmToMinutes(hhmm);
  return m < 12 * 60 ? m + 12 * 60 : m - 12 * 60;
}

export function meanBedtimeFromNoon(nights: SleepNight[]): number | undefined {
  if (nights.length === 0) return undefined;
  return nights.reduce((s, n) => s + bedtimeFromNoon(n.bedtime), 0) / nights.length;
}

/**
 * @param night       die zu bewertende Nacht
 * @param goalHours   Schlafziel in Stunden
 * @param previous    frühere Nächte (für Regelmäßigkeit, die letzten 14 werden genutzt; mind. 3 nötig)
 */
export function sleepScore(night: SleepNight, goalHours: number, previous: SleepNight[] = []): SleepScore {
  const components: SleepScoreComponent[] = [];
  const goalMin = goalHours * 60;

  components.push({ key: 'duration', label: 'Dauer', max: 50, points: 50 * lerp01(night.asleepMin, 0, goalMin) });

  if (night.deepMin !== undefined && night.remMin !== undefined && night.asleepMin > 0) {
    const share = (night.deepMin + night.remMin) / night.asleepMin;
    components.push({ key: 'restorative', label: 'Tief- & REM-Schlaf', max: 15, points: 15 * lerp01(share, 0.2, 0.4) });
  }

  if (night.awakeMin !== undefined) {
    const inBed = night.asleepMin + night.awakeMin;
    const awakeShare = inBed > 0 ? night.awakeMin / inBed : 0;
    components.push({ key: 'calm', label: 'Ruhe (wenig Wachphasen)', max: 15, points: 15 * (1 - lerp01(awakeShare, 0.05, 0.2)) });
  }

  const recent = previous.filter((n) => n.date < night.date).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);
  const mean = recent.length >= 3 ? meanBedtimeFromNoon(recent) : undefined;
  if (mean !== undefined) {
    const deviation = Math.abs(bedtimeFromNoon(night.bedtime) - mean);
    components.push({ key: 'regularity', label: 'Regelmäßigkeit', max: 20, points: 20 * (1 - lerp01(deviation, 0, 90)) });
  }

  const max = components.reduce((s, c) => s + c.max, 0);
  const pts = components.reduce((s, c) => s + c.points, 0);
  return {
    score: Math.round((pts / max) * 100),
    components: components.map((c) => ({ ...c, points: Math.round(c.points * 10) / 10 })),
  };
}
