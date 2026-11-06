import type { Checkin, DailyVitals, ISODate, ReadinessThresholds, SleepNight } from './types';
import { addDays, formatDuration } from './dates';

/**
 * Ampel als Trainingsempfehlung – Orientierungshilfe, keine medizinische Beratung.
 *
 * Jeder Faktor wird als gut / mittel / schlecht bewertet (Schwellen in den Einstellungen):
 *  - Schlaf der letzten Nacht im Verhältnis zum Ziel
 *  - subjektive Erholung (Check-in)
 *  - Muskelkater (Check-in)
 *  - Ruhepuls über dem eigenen 14-Tage-Schnitt (mind. 5 Vergleichswerte)
 *  - HRV unter dem eigenen 14-Tage-Schnitt (mind. 5 Vergleichswerte)
 *  - optional Kniebeschwerden (mittel ab 3, schlecht ab 5)
 *
 * Ergebnis:
 *  - Rot:  mindestens zwei Faktoren schlecht
 *  - Gelb: ein Faktor schlecht oder mindestens zwei mittel
 *  - Grün: sonst
 *  - Unbekannt: weder Schlaf noch Check-in für heute vorhanden
 */
export type Level = 'good' | 'warn' | 'bad';
export type Readiness = 'green' | 'yellow' | 'red' | 'unknown';

export interface Factor {
  key: 'sleep' | 'recovery' | 'soreness' | 'restingHr' | 'hrv' | 'knee';
  label: string;
  level: Level;
  detail: string;
}

export interface ReadinessResult {
  status: Readiness;
  factors: Factor[];
  /** Faktoren, die mangels Daten nicht bewertet werden konnten. */
  missing: string[];
  headline: string;
  advice: string;
}

const MIN_BASELINE = 5;

export function baseline(values: (number | undefined)[]): number | undefined {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length >= MIN_BASELINE ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
}

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });

export function computeReadiness(input: {
  date: ISODate;
  checkin?: Checkin;
  night?: SleepNight;
  vitals: DailyVitals[];
  sleepGoalHours: number;
  t: ReadinessThresholds;
}): ReadinessResult {
  const { date, checkin, night, vitals, sleepGoalHours, t } = input;
  const factors: Factor[] = [];
  const missing: string[] = [];

  if (night) {
    const ratio = night.asleepMin / (sleepGoalHours * 60);
    const level: Level = ratio >= t.sleepGood ? 'good' : ratio < t.sleepBad ? 'bad' : 'warn';
    factors.push({ key: 'sleep', label: 'Schlaf', level, detail: `${formatDuration(night.asleepMin)}, Ziel ${fmt(sleepGoalHours)} h` });
  } else missing.push('Schlaf');

  if (checkin) {
    const r = checkin.recovery;
    factors.push({
      key: 'recovery',
      label: 'Erholung',
      level: r >= t.recoveryGood ? 'good' : r <= t.recoveryBad ? 'bad' : 'warn',
      detail: `${r}/10 gefühlt`,
    });
    const s = checkin.soreness;
    factors.push({
      key: 'soreness',
      label: 'Muskelkater',
      level: s <= t.sorenessGood ? 'good' : s >= t.sorenessBad ? 'bad' : 'warn',
      detail: `${s}/10`,
    });
    if (t.includeKnee && checkin.kneePain !== undefined) {
      const k = checkin.kneePain;
      factors.push({ key: 'knee', label: 'Knie', level: k >= 5 ? 'bad' : k >= 3 ? 'warn' : 'good', detail: `${k}/10 Beschwerden` });
    }
  } else missing.push('Check-in');

  const from = addDays(date, -14);
  const history = vitals.filter((v) => v.date >= from && v.date < date);
  const todayV = vitals.find((v) => v.date === date);

  const rhrBase = baseline(history.map((v) => v.restingHr));
  if (todayV?.restingHr !== undefined && rhrBase !== undefined) {
    const diff = todayV.restingHr - rhrBase;
    factors.push({
      key: 'restingHr',
      label: 'Ruhepuls',
      level: diff >= t.restingHrBad ? 'bad' : diff >= t.restingHrWarn ? 'warn' : 'good',
      detail: `${todayV.restingHr} bpm, Ø ${fmt(rhrBase)} (${diff >= 0 ? '+' : ''}${fmt(diff)})`,
    });
  } else missing.push('Ruhepuls');

  const hrvBase = baseline(history.map((v) => v.hrvSdnnMs));
  if (todayV?.hrvSdnnMs !== undefined && hrvBase !== undefined) {
    const dropPct = ((hrvBase - todayV.hrvSdnnMs) / hrvBase) * 100;
    factors.push({
      key: 'hrv',
      label: 'HRV',
      level: dropPct >= t.hrvBadPct ? 'bad' : dropPct >= t.hrvWarnPct ? 'warn' : 'good',
      detail: `${Math.round(todayV.hrvSdnnMs)} ms, Ø ${Math.round(hrvBase)} (${dropPct > 0 ? '−' : '+'}${Math.abs(Math.round(dropPct))} %)`,
    });
  } else missing.push('HRV');

  const bad = factors.filter((f) => f.level === 'bad').length;
  const warn = factors.filter((f) => f.level === 'warn').length;
  let status: Readiness;
  if (!night && !checkin) status = 'unknown';
  else if (bad >= 2) status = 'red';
  else if (bad === 1 || warn >= 2) status = 'yellow';
  else status = 'green';

  return { status, factors, missing, ...TEXT[status] };
}

const TEXT: Record<Readiness, { headline: string; advice: string }> = {
  green: { headline: 'Bereit', advice: 'Gute Voraussetzungen für ein normales oder intensives Training.' },
  yellow: { headline: 'Mit Bedacht', advice: 'Training ja, aber Intensität oder Volumen etwas reduzieren.' },
  red: { headline: 'Erholung', advice: 'Heute eher Mobility, Spaziergang oder Pause.' },
  unknown: { headline: 'Noch offen', advice: 'Mach den Check-in, um eine Empfehlung zu bekommen.' },
};
