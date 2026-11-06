import Dexie, { type Table } from 'dexie';
import type {
  BodyMetric,
  Checkin,
  DailyVitals,
  Exercise,
  Settings,
  SleepNight,
  SyncMeta,
  Todo,
  Workout,
  WorkoutSet,
  WorkoutTemplate,
} from '../domain/types';
import { DEFAULT_EXERCISES, DEFAULT_SETTINGS, DEFAULT_TEMPLATES } from './defaults';

/** Zuordnung beim Import, z. B. Zepp „Sonstiges“ → Mobility. */
export interface ImportRule extends SyncMeta {
  source: string;
  match: string;
  workoutType: Workout['type'];
  label?: string;
}

export class FitnessDB extends Dexie {
  checkins!: Table<Checkin, string>;
  sleepNights!: Table<SleepNight, string>;
  dailyVitals!: Table<DailyVitals, string>;
  workouts!: Table<Workout, string>;
  workoutSets!: Table<WorkoutSet, string>;
  exercises!: Table<Exercise, string>;
  templates!: Table<WorkoutTemplate, string>;
  todos!: Table<Todo, string>;
  bodyMetrics!: Table<BodyMetric, string>;
  importRules!: Table<ImportRule, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'fitness-dashboard') {
    super(name);

    // Schema-Versionen: Nie bestehende Versionen ändern, sondern eine neue
    // anhängen, z. B.
    //   this.version(2).stores({ ... }).upgrade(tx => tx.table('x').toCollection().modify(...))
    // Dexie führt die Migrationen beim Öffnen automatisch der Reihe nach aus.
    this.version(1).stores({
      checkins: 'id, date, updatedAt',
      sleepNights: 'id, date, updatedAt',
      dailyVitals: 'id, date, updatedAt',
      workouts: 'id, date, type, externalId, updatedAt',
      workoutSets: 'id, workoutId, exerciseId, updatedAt',
      exercises: 'id, name, updatedAt',
      templates: 'id, updatedAt',
      todos: 'id, due, done, updatedAt',
      bodyMetrics: 'id, date, updatedAt',
      importRules: 'id, updatedAt',
      settings: 'id',
    });

    this.on('populate', async (tx) => {
      await tx.table('exercises').bulkAdd(DEFAULT_EXERCISES);
      await tx.table('templates').bulkAdd(DEFAULT_TEMPLATES);
      await tx.table('settings').add(DEFAULT_SETTINGS);
      await tx.table('importRules').add({
        id: 'rule-zepp-other',
        source: 'Zepp',
        match: 'HKWorkoutActivityTypeOther',
        workoutType: 'mobility',
        label: 'Dehnen',
        updatedAt: 0,
        deleted: 0,
      } satisfies ImportRule);
    });
  }
}

export const db = new FitnessDB();

/** Tabellen mit synchronisierbaren Datensätzen (alles außer Einstellungen). */
export const SYNC_TABLES = [
  'checkins',
  'sleepNights',
  'dailyVitals',
  'workouts',
  'workoutSets',
  'exercises',
  'templates',
  'todos',
  'bodyMetrics',
  'importRules',
] as const;
export type SyncTableName = (typeof SYNC_TABLES)[number];
