/**
 * Datenmodell des Dashboards.
 *
 * Alle synchronisierten Datensätze tragen `id`, `updatedAt` (ms seit Epoch)
 * und `deleted` (0 | 1, Löschmarkierung). So lassen sich Änderungen von
 * Handy und PC später pro Datensatz zusammenführen („neuere Änderung gewinnt“).
 *
 * Interne Einheiten: Gewicht in kg, Distanz in km, Zeiten in Minuten,
 * Datumsangaben als lokales ISO-Datum `YYYY-MM-DD`, Uhrzeiten als `HH:MM`.
 */

export type ISODate = string; // YYYY-MM-DD (lokal)
export type HHMM = string; // 24-h-Uhrzeit

export interface SyncMeta {
  id: string;
  updatedAt: number;
  deleted: 0 | 1;
}

export type DataSource = 'manual' | 'apple-health' | 'demo';

/** Morgendlicher Check-in, eine Zeile pro Tag. Skalen 1–10, kneePain 0–10. */
export interface Checkin extends SyncMeta {
  date: ISODate;
  recovery: number;
  soreness: number;
  mood: number;
  energy: number;
  stress: number;
  sleepQuality: number;
  kneePain?: number;
  tags: string[];
  note?: string;
}

/** Eine Nacht, zugeordnet zum Aufwachtag. */
export interface SleepNight extends SyncMeta {
  date: ISODate;
  bedtime: HHMM;
  wakeTime: HHMM;
  asleepMin: number;
  deepMin?: number;
  remMin?: number;
  coreMin?: number;
  awakeMin?: number;
  source: DataSource;
}

/** Tageswerte aus Uhr/Handy. */
export interface DailyVitals extends SyncMeta {
  date: ISODate;
  restingHr?: number;
  hrvSdnnMs?: number;
  steps?: number;
  stepsSource?: string;
  source: DataSource;
}

export type WorkoutType = 'strength' | 'cardio' | 'mobility' | 'other';

export interface Workout extends SyncMeta {
  date: ISODate;
  start?: HHMM;
  type: WorkoutType;
  /** Freier Untertyp, z. B. „Laufen“, „Gehen“, „Dehnen“. */
  label?: string;
  templateId?: string;
  durationMin: number;
  rpe?: number;
  distanceKm?: number;
  avgHr?: number;
  kcal?: number;
  note?: string;
  /** Kennung aus einem Import, verhindert Duplikate. */
  externalId?: string;
  source: DataSource;
}

export interface WorkoutSet extends SyncMeta {
  workoutId: string;
  exerciseId: string;
  order: number;
  reps: number;
  weightKg: number;
  warmup: 0 | 1;
}

export type MuscleGroup = 'Brust' | 'Schultern' | 'Trizeps' | 'Rücken' | 'Bizeps' | 'Rumpf' | 'Beine' | 'Sonstiges';
export type SplitTag = 'push' | 'pull' | 'other';

export interface Exercise extends SyncMeta {
  name: string;
  muscleGroup: MuscleGroup;
  split: SplitTag;
  archived: 0 | 1;
}

export interface WorkoutTemplate extends SyncMeta {
  name: string;
  type: WorkoutType;
  exerciseIds: string[];
}

export type TodoPriority = 'hoch' | 'mittel' | 'niedrig';
export type TodoCategory = 'Training' | 'Alltag' | 'Ernährung' | 'Sonstiges';

export interface Todo extends SyncMeta {
  title: string;
  due?: ISODate;
  priority: TodoPriority;
  category: TodoCategory;
  done: 0 | 1;
  doneAt?: number;
  /** Geplante Einheit: beim Abhaken öffnet sich das Trainingsformular mit dieser Vorlage. */
  plannedTemplateId?: string;
  workoutId?: string;
}

export interface BodyMetric extends SyncMeta {
  date: ISODate;
  weightKg?: number;
  waistCm?: number;
  source: DataSource;
}

export interface Goals {
  sleepHours: number;
  strengthPerWeek: number;
  mobilityPerWeek: number;
  runsPerWeek: number;
  stepsPerDay: number;
}

export interface ReadinessThresholds {
  /** Anteil vom Schlafziel: ab hier „gut“ bzw. darunter „schlecht“. */
  sleepGood: number;
  sleepBad: number;
  /** Subjektive Erholung (1–10). */
  recoveryGood: number;
  recoveryBad: number;
  /** Muskelkater (1–10), höher = schlechter. */
  sorenessGood: number;
  sorenessBad: number;
  /** Ruhepuls: Abweichung über dem 14-Tage-Schnitt in bpm. */
  restingHrWarn: number;
  restingHrBad: number;
  /** HRV: Abweichung unter dem 14-Tage-Schnitt in Prozent. */
  hrvWarnPct: number;
  hrvBadPct: number;
  /** Kniebeschwerden in die Ampel einbeziehen. */
  includeKnee: boolean;
}

export interface Settings {
  id: 'settings';
  updatedAt: number;
  goals: Goals;
  readiness: ReadinessThresholds;
  weightUnit: 'kg' | 'lb';
  distanceUnit: 'km' | 'mi';
  theme: 'system' | 'light' | 'dark';
  trackKnee: boolean;
  tags: string[];
  schemaVersion: number;
}
