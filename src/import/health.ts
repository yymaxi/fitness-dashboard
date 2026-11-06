/**
 * Apple-Health-Import: Rohdaten sammeln und in Datensätze des Dashboards umwandeln.
 *
 * Reine Logik ohne DOM/IndexedDB – läuft im Web Worker und in den Tests.
 *
 * - Schlaf: nur Einträge der Schlafquelle (Standard „Zepp“), zu Nächten gruppiert.
 *   Sobald eine Nacht Phasen enthält, werden „InBed“-Einträge ignoriert.
 * - Schritte: pro Tag und Quelle summiert, dann pro Tag das Maximum über alle
 *   Quellen (iPhone und Zepp zählen dieselben Schritte doppelt).
 * - HRV: Median aller SDNN-Werte zwischen Einschlafen und Aufwachen.
 * - Ruhepuls: Tagesmittel.
 * - Workouts: stabile externalId, damit erneute Importe keine Duplikate erzeugen.
 */
import type { DailyVitals, HHMM, ISODate, SleepNight, Workout, WorkoutType } from '../domain/types';
import type { ImportRule } from '../data/db';
import { parseAttrs, type TagKind } from './xmlStream';

// ---------------------------------------------------------------- Zeit

export interface HealthTime {
  /** Datum und Uhrzeit so, wie sie am Aufzeichnungsort auf der Uhr standen. */
  date: ISODate;
  time: HHMM;
  /** Absoluter Zeitpunkt (ms seit Epoch) – für Reihenfolge und Abstände. */
  ms: number;
}

/** "2026-11-05 23:12:00 +0100" → lokale Wanduhrzeit + absoluter Zeitpunkt. */
export function parseHealthDate(s: string): HealthTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-])(\d{2}):?(\d{2})/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, sign, oh, om] = m as unknown as string[];
  const offsetMin = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, ms: utc - offsetMin * 60_000 };
}

// ---------------------------------------------------------------- Rohdaten

export type SleepStage = 'inBed' | 'asleep' | 'core' | 'deep' | 'rem' | 'awake';

const SLEEP_VALUES: Record<string, SleepStage> = {
  HKCategoryValueSleepAnalysisInBed: 'inBed',
  HKCategoryValueSleepAnalysisAsleep: 'asleep',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'asleep',
  HKCategoryValueSleepAnalysisAsleepCore: 'core',
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'rem',
  HKCategoryValueSleepAnalysisAwake: 'awake',
};

export interface SleepSegment {
  stage: SleepStage;
  start: HealthTime;
  end: HealthTime;
}

export interface RawWorkout {
  activityType: string;
  source: string;
  start: HealthTime;
  end: HealthTime;
  durationMin: number;
  distanceKm?: number;
  kcal?: number;
  avgHr?: number;
}

export interface HealthRaw {
  sleep: SleepSegment[];
  /** Datum → Quelle → Schritte */
  steps: Map<ISODate, Map<string, number>>;
  hrv: { ms: number; value: number }[];
  restingHr: Map<ISODate, number[]>;
  workouts: RawWorkout[];
}

export interface CollectOptions {
  /** Teil des Quellnamens, aus dem Schlaf übernommen wird (ohne Groß-/Kleinschreibung). */
  sleepSource: string;
}

export const DEFAULT_COLLECT_OPTIONS: CollectOptions = { sleepSource: 'Zepp' };

const T_SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const T_STEPS = 'HKQuantityTypeIdentifierStepCount';
const T_HRV = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const T_RHR = 'HKQuantityTypeIdentifierRestingHeartRate';
const WANTED = [T_SLEEP, T_STEPS, T_HRV, T_RHR].map((t) => `"${t}"`);

/** Sammelt beim Streamen die benötigten Einträge aus export.xml. */
export class HealthCollector {
  readonly raw: HealthRaw = { sleep: [], steps: new Map(), hrv: [], restingHr: new Map(), workouts: [] };
  private readonly sleepSource: string;
  private workout: RawWorkout | null = null;

  constructor(opts: CollectOptions = DEFAULT_COLLECT_OPTIONS) {
    this.sleepSource = opts.sleepSource.toLowerCase();
  }

  readonly onTag = (name: string, rawAttrs: string, kind: TagKind): void => {
    if (name === 'Record') {
      if (kind !== 'close' && WANTED.some((w) => rawAttrs.includes(w))) this.record(parseAttrs(rawAttrs));
    } else if (name === 'Workout') {
      if (kind === 'close') this.finishWorkout();
      else {
        this.startWorkout(parseAttrs(rawAttrs));
        if (kind === 'empty') this.finishWorkout();
      }
    } else if (name === 'WorkoutStatistics' && this.workout && kind !== 'close') {
      this.workoutStats(parseAttrs(rawAttrs));
    }
  };

  private record(a: Record<string, string>): void {
    const start = parseHealthDate(a.startDate ?? '');
    if (!start) return;
    const source = a.sourceName ?? '';
    switch (a.type) {
      case T_SLEEP: {
        const stage = SLEEP_VALUES[a.value ?? ''];
        const end = parseHealthDate(a.endDate ?? '');
        if (stage && end && end.ms > start.ms && source.toLowerCase().includes(this.sleepSource)) {
          this.raw.sleep.push({ stage, start, end });
        }
        break;
      }
      case T_STEPS: {
        const v = Number(a.value);
        if (!Number.isFinite(v)) return;
        let day = this.raw.steps.get(start.date);
        if (!day) this.raw.steps.set(start.date, (day = new Map()));
        day.set(source, (day.get(source) ?? 0) + v);
        break;
      }
      case T_HRV: {
        const v = Number(a.value);
        if (Number.isFinite(v) && v > 0) this.raw.hrv.push({ ms: start.ms, value: v });
        break;
      }
      case T_RHR: {
        const v = Number(a.value);
        if (!Number.isFinite(v) || v <= 0) return;
        const list = this.raw.restingHr.get(start.date);
        if (list) list.push(v);
        else this.raw.restingHr.set(start.date, [v]);
        break;
      }
    }
  }

  private startWorkout(a: Record<string, string>): void {
    const start = parseHealthDate(a.startDate ?? '');
    const end = parseHealthDate(a.endDate ?? '');
    if (!start || !end) {
      this.workout = null;
      return;
    }
    const dur = Number(a.duration);
    const durationMin = Number.isFinite(dur) ? toMinutes(dur, a.durationUnit) : (end.ms - start.ms) / 60_000;
    const w: RawWorkout = { activityType: a.workoutActivityType ?? 'HKWorkoutActivityTypeOther', source: a.sourceName ?? '', start, end, durationMin };
    const dist = toKm(Number(a.totalDistance), a.totalDistanceUnit);
    if (dist !== undefined) w.distanceKm = dist;
    const kcal = toKcal(Number(a.totalEnergyBurned), a.totalEnergyBurnedUnit);
    if (kcal !== undefined) w.kcal = kcal;
    this.workout = w;
  }

  private workoutStats(a: Record<string, string>): void {
    const w = this.workout!;
    const type = a.type ?? '';
    if (type.startsWith('HKQuantityTypeIdentifierDistance') && w.distanceKm === undefined) {
      const d = toKm(Number(a.sum), a.unit);
      if (d !== undefined) w.distanceKm = d;
    } else if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned' && w.kcal === undefined) {
      const k = toKcal(Number(a.sum), a.unit);
      if (k !== undefined) w.kcal = k;
    } else if (type === 'HKQuantityTypeIdentifierHeartRate') {
      const hr = Number(a.average);
      if (Number.isFinite(hr) && hr > 0) w.avgHr = hr;
    }
  }

  private finishWorkout(): void {
    if (this.workout) this.raw.workouts.push(this.workout);
    this.workout = null;
  }
}

function toMinutes(v: number, unit = 'min'): number {
  if (unit === 's') return v / 60;
  if (unit === 'h' || unit === 'hr') return v * 60;
  return v;
}

function toKm(v: number, unit = 'km'): number | undefined {
  if (!Number.isFinite(v) || v <= 0) return undefined;
  const f: Record<string, number> = { km: 1, m: 0.001, mi: 1.609344, yd: 0.0009144, ft: 0.0003048 };
  const factor = f[unit];
  return factor === undefined ? undefined : v * factor;
}

function toKcal(v: number, unit = 'kcal'): number | undefined {
  if (!Number.isFinite(v) || v <= 0) return undefined;
  if (unit === 'kcal' || unit === 'Cal') return v;
  if (unit === 'kJ') return v / 4.184;
  if (unit === 'cal') return v / 1000;
  return undefined;
}

// ---------------------------------------------------------------- Schlaf → Nächte

export type ImportedNight = Omit<SleepNight, 'updatedAt' | 'deleted'> & { startMs: number; endMs: number };

export interface SleepGroupOptions {
  /** Größere Lücken trennen zwei Schlafphasen (z. B. Nacht und Mittagsschlaf). */
  maxGapMin: number;
  /** Kürzere Abschnitte gelten nicht als Nacht. */
  minAsleepMin: number;
}

const DEFAULT_SLEEP_GROUP: SleepGroupOptions = { maxGapMin: 120, minAsleepMin: 120 };

type Interval = [number, number];

/** Gesamtlänge der Vereinigung von Intervallen in Minuten (Überlappungen zählen einmal). */
function unionMinutes(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = sorted[0]!;
  for (const [s, e] of sorted.slice(1)) {
    if (s > ce) {
      total += ce - cs;
      cs = s;
      ce = e;
    } else if (e > ce) ce = e;
  }
  total += ce - cs;
  return total / 60_000;
}

const ASLEEP: SleepStage[] = ['asleep', 'core', 'deep', 'rem'];

/**
 * Gruppiert Schlafabschnitte zu Nächten. Abschnitte mit weniger als `maxGapMin`
 * Abstand gehören zusammen; eine Nacht zählt zum Aufwachtag. Gibt es pro Tag
 * mehrere Gruppen (z. B. Mittagsschlaf), gewinnt die mit dem meisten Schlaf.
 */
export function groupSleepNights(segments: SleepSegment[], opts: Partial<SleepGroupOptions> = {}): ImportedNight[] {
  const { maxGapMin, minAsleepMin } = { ...DEFAULT_SLEEP_GROUP, ...opts };
  const sorted = [...segments].sort((a, b) => a.start.ms - b.start.ms);
  const clusters: SleepSegment[][] = [];
  let clusterEnd = -Infinity;
  for (const seg of sorted) {
    const current = clusters.at(-1);
    if (current && seg.start.ms - clusterEnd <= maxGapMin * 60_000) {
      current.push(seg);
      clusterEnd = Math.max(clusterEnd, seg.end.ms);
    } else {
      clusters.push([seg]);
      clusterEnd = seg.end.ms;
    }
  }

  const byDate = new Map<ISODate, ImportedNight>();
  for (const cluster of clusters) {
    const hasStages = cluster.some((s) => s.stage !== 'inBed');
    const used = hasStages ? cluster.filter((s) => s.stage !== 'inBed') : cluster;
    const iv = (stages: SleepStage[]): Interval[] => used.filter((s) => stages.includes(s.stage)).map((s) => [s.start.ms, s.end.ms]);

    const first = used.reduce((a, b) => (b.start.ms < a.start.ms ? b : a));
    const last = used.reduce((a, b) => (b.end.ms > a.end.ms ? b : a));
    const asleepMin = Math.round(unionMinutes(iv(hasStages ? ASLEEP : ['inBed'])));
    if (asleepMin < minAsleepMin) continue;

    const night: ImportedNight = {
      id: `sl-${last.end.date}`,
      date: last.end.date,
      bedtime: first.start.time,
      wakeTime: last.end.time,
      asleepMin,
      source: 'apple-health',
      startMs: first.start.ms,
      endMs: last.end.ms,
    };
    if (hasStages) {
      const phases: [keyof ImportedNight, SleepStage][] = [
        ['deepMin', 'deep'],
        ['remMin', 'rem'],
        ['coreMin', 'core'],
        ['awakeMin', 'awake'],
      ];
      for (const [key, stage] of phases) {
        const ivs = iv([stage]);
        if (ivs.length) (night as unknown as Record<string, number>)[key] = Math.round(unionMinutes(ivs));
      }
    }
    const prev = byDate.get(night.date);
    if (!prev || night.asleepMin > prev.asleepMin) byDate.set(night.date, night);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- Schritte, HRV, Ruhepuls

/** Pro Tag das Maximum über alle Quellen (dieselben Schritte werden von Handy und Uhr gezählt). */
export function dailySteps(steps: HealthRaw['steps']): Map<ISODate, { steps: number; source: string }> {
  const out = new Map<ISODate, { steps: number; source: string }>();
  for (const [date, bySource] of steps) {
    let best: { steps: number; source: string } | null = null;
    for (const [source, n] of bySource) if (!best || n > best.steps) best = { steps: Math.round(n), source };
    if (best) out.set(date, best);
  }
  return out;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** HRV-Median je Nacht (Aufwachtag), nur Messungen zwischen Einschlafen und Aufwachen. */
export function hrvDuringSleep(nights: ImportedNight[], samples: HealthRaw['hrv']): Map<ISODate, number> {
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  const out = new Map<ISODate, number>();
  for (const n of nights) {
    // binäre Suche nach dem ersten Wert ab Einschlafen
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]!.ms < n.startMs) lo = mid + 1;
      else hi = mid;
    }
    const values: number[] = [];
    for (let i = lo; i < sorted.length && sorted[i]!.ms <= n.endMs; i++) values.push(sorted[i]!.value);
    const m = median(values);
    if (m !== undefined) out.set(n.date, Math.round(m * 10) / 10);
  }
  return out;
}

// ---------------------------------------------------------------- Workouts

const ACTIVITY: Record<string, { type: WorkoutType; label: string }> = {
  Running: { type: 'cardio', label: 'Laufen' },
  Walking: { type: 'cardio', label: 'Gehen' },
  Hiking: { type: 'cardio', label: 'Wandern' },
  Cycling: { type: 'cardio', label: 'Radfahren' },
  Swimming: { type: 'cardio', label: 'Schwimmen' },
  Rowing: { type: 'cardio', label: 'Rudern' },
  Elliptical: { type: 'cardio', label: 'Crosstrainer' },
  StairClimbing: { type: 'cardio', label: 'Treppensteigen' },
  HighIntensityIntervalTraining: { type: 'cardio', label: 'HIIT' },
  MixedCardio: { type: 'cardio', label: 'Cardio' },
  TraditionalStrengthTraining: { type: 'strength', label: 'Krafttraining' },
  FunctionalStrengthTraining: { type: 'strength', label: 'Funktionelles Training' },
  CoreTraining: { type: 'strength', label: 'Rumpftraining' },
  Yoga: { type: 'mobility', label: 'Yoga' },
  Flexibility: { type: 'mobility', label: 'Dehnen' },
  Pilates: { type: 'mobility', label: 'Pilates' },
  MindAndBody: { type: 'mobility', label: 'Mind & Body' },
  Cooldown: { type: 'mobility', label: 'Cooldown' },
  Other: { type: 'other', label: 'Sonstiges' },
};

const shortActivity = (t: string) => t.replace(/^HKWorkoutActivityType/, '');

/** FNV-1a, 32 bit, hex – für stabile, kurze IDs. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function workoutExternalId(w: RawWorkout): string {
  return `apple-health|${w.source}|${shortActivity(w.activityType)}|${w.start.ms}`;
}

/** Erste passende, nicht gelöschte Regel (Quelle als Teilstring, Aktivität exakt). */
export function findRule(w: RawWorkout, rules: ImportRule[]): ImportRule | undefined {
  const src = w.source.toLowerCase();
  const act = shortActivity(w.activityType);
  return rules.find((r) => r.deleted !== 1 && src.includes(r.source.toLowerCase()) && shortActivity(r.match) === act);
}

export type ImportedWorkout = Omit<Workout, 'updatedAt' | 'deleted'>;

export function mapWorkout(w: RawWorkout, rules: ImportRule[]): ImportedWorkout {
  const act = shortActivity(w.activityType);
  const rule = findRule(w, rules);
  const base = ACTIVITY[act] ?? { type: 'other' as const, label: act };
  const externalId = workoutExternalId(w);
  const out: ImportedWorkout = {
    id: `wo-ah-${hash(externalId)}`,
    date: w.start.date,
    start: w.start.time,
    type: rule?.workoutType ?? base.type,
    label: rule?.label ?? base.label,
    durationMin: Math.max(1, Math.round(w.durationMin)),
    externalId,
    source: 'apple-health',
  };
  if (w.distanceKm !== undefined) out.distanceKm = Math.round(w.distanceKm * 100) / 100;
  if (w.kcal !== undefined) out.kcal = Math.round(w.kcal);
  if (w.avgHr !== undefined) out.avgHr = Math.round(w.avgHr);
  return out;
}

// ---------------------------------------------------------------- Ergebnis

export type ImportedVitals = Omit<DailyVitals, 'updatedAt' | 'deleted'>;

export interface HealthImport {
  sleepNights: Omit<SleepNight, 'updatedAt' | 'deleted'>[];
  dailyVitals: ImportedVitals[];
  workouts: ImportedWorkout[];
}

export function buildHealthImport(raw: HealthRaw, rules: ImportRule[], sleepOpts?: Partial<SleepGroupOptions>): HealthImport {
  const nights = groupSleepNights(raw.sleep, sleepOpts);
  const steps = dailySteps(raw.steps);
  const hrv = hrvDuringSleep(nights, raw.hrv);

  const dates = new Set<ISODate>([...steps.keys(), ...hrv.keys(), ...raw.restingHr.keys()]);
  const dailyVitals: ImportedVitals[] = [...dates].sort().map((date) => {
    const v: ImportedVitals = { id: `vt-${date}`, date, source: 'apple-health' };
    const s = steps.get(date);
    if (s) {
      v.steps = s.steps;
      v.stepsSource = s.source;
    }
    const h = hrv.get(date);
    if (h !== undefined) v.hrvSdnnMs = h;
    const rhr = raw.restingHr.get(date);
    if (rhr?.length) v.restingHr = Math.round(rhr.reduce((a, b) => a + b, 0) / rhr.length);
    return v;
  });

  // Gleiches Workout mehrfach im Export (kommt vor) → nur einmal
  const workouts = new Map<string, ImportedWorkout>();
  for (const w of raw.workouts) {
    const mapped = mapWorkout(w, rules);
    workouts.set(mapped.externalId!, mapped);
  }

  return {
    sleepNights: nights.map(({ startMs: _s, endMs: _e, ...n }) => n),
    dailyVitals,
    workouts: [...workouts.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
