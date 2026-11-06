import type { Checkin, ISODate, SleepNight } from './types';
import { minutesBetween } from './dates';

export interface CheckinDraft {
  date: ISODate;
  bedtime: string;
  wakeTime: string;
  sleepQuality: number;
  recovery: number;
  soreness: number;
  mood: number;
  energy: number;
  stress: number;
  kneePain?: number;
  tags: string[];
  note: string;
}

const NEUTRAL = { sleepQuality: 6, recovery: 6, soreness: 3, mood: 6, energy: 6, stress: 4 };

/**
 * Vorbelegung für den Check-in.
 *
 * - Gibt es für den Tag schon einen Check-in, wird er zum Bearbeiten geladen.
 * - Sonst kommen Skalenwerte vom letzten Check-in (die Tagesform ändert sich
 *   meist nur leicht), Tags und Notiz bleiben leer.
 * - Schlafzeiten kommen bevorzugt aus der Nacht des Tages (z. B. importiert),
 *   sonst aus der letzten erfassten Nacht.
 */
export function checkinDefaults(
  date: ISODate,
  opts: {
    existing?: Checkin;
    previous?: Checkin;
    nightToday?: SleepNight;
    lastNight?: SleepNight;
    trackKnee: boolean;
  },
): CheckinDraft {
  const { existing, previous, nightToday, lastNight, trackKnee } = opts;
  const night = nightToday ?? lastNight;
  const base = existing ?? previous;
  return {
    date,
    bedtime: night?.bedtime ?? '23:00',
    wakeTime: night?.wakeTime ?? '07:00',
    sleepQuality: base?.sleepQuality ?? NEUTRAL.sleepQuality,
    recovery: base?.recovery ?? NEUTRAL.recovery,
    soreness: base?.soreness ?? NEUTRAL.soreness,
    mood: base?.mood ?? NEUTRAL.mood,
    energy: base?.energy ?? NEUTRAL.energy,
    stress: base?.stress ?? NEUTRAL.stress,
    kneePain: trackKnee ? (base?.kneePain ?? 0) : undefined,
    tags: existing?.tags ?? [],
    note: existing?.note ?? '',
  };
}

/** Schlafdauer aus Bett- und Aufwachzeit (für manuelle Erfassung ohne Phasen). */
export function manualSleepMinutes(bedtime: string, wakeTime: string): number {
  return minutesBetween(bedtime, wakeTime);
}

export function clampScale(v: number, min = 1, max = 10): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}
