import type { Exercise, MuscleGroup, Settings, SplitTag, WorkoutTemplate } from '../domain/types';

export const SCHEMA_VERSION = 1;

const ex = (id: string, name: string, muscleGroup: MuscleGroup, split: SplitTag): Exercise => ({
  id,
  name,
  muscleGroup,
  split,
  archived: 0,
  updatedAt: 0,
  deleted: 0,
});

/** Startübungen für den Push/Pull-Split (ohne Beine, alle bearbeitbar). */
export const DEFAULT_EXERCISES: Exercise[] = [
  ex('ex-bench', 'Bankdrücken', 'Brust', 'push'),
  ex('ex-incline-db', 'Schrägbankdrücken (KH)', 'Brust', 'push'),
  ex('ex-ohp', 'Schulterdrücken', 'Schultern', 'push'),
  ex('ex-lateral', 'Seitheben', 'Schultern', 'push'),
  ex('ex-fly', 'Butterfly', 'Brust', 'push'),
  ex('ex-pushdown', 'Trizepsdrücken am Kabel', 'Trizeps', 'push'),
  ex('ex-latpull', 'Latzug', 'Rücken', 'pull'),
  ex('ex-cablerow', 'Kabelrudern', 'Rücken', 'pull'),
  ex('ex-bbrow', 'Langhantelrudern', 'Rücken', 'pull'),
  ex('ex-facepull', 'Face Pulls', 'Schultern', 'pull'),
  ex('ex-curl', 'Bizepscurls', 'Bizeps', 'pull'),
  ex('ex-hammer', 'Hammercurls', 'Bizeps', 'pull'),
];

export const DEFAULT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'tpl-push',
    name: 'Push',
    type: 'strength',
    exerciseIds: ['ex-bench', 'ex-incline-db', 'ex-ohp', 'ex-lateral', 'ex-fly', 'ex-pushdown'],
    updatedAt: 0,
    deleted: 0,
  },
  {
    id: 'tpl-pull',
    name: 'Pull',
    type: 'strength',
    exerciseIds: ['ex-latpull', 'ex-cablerow', 'ex-bbrow', 'ex-facepull', 'ex-curl', 'ex-hammer'],
    updatedAt: 0,
    deleted: 0,
  },
];

export const DEFAULT_TAGS = ['Alkohol', 'spät gegessen', 'Bildschirm vor dem Schlaf', 'Koffein spät', 'Stressiger Tag', 'Krank'];

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  updatedAt: 0,
  goals: {
    sleepHours: 8,
    strengthPerWeek: 4,
    mobilityPerWeek: 2,
    runsPerWeek: 1,
    stepsPerDay: 10000,
  },
  readiness: {
    sleepGood: 0.9,
    sleepBad: 0.75,
    recoveryGood: 7,
    recoveryBad: 4,
    sorenessGood: 4,
    sorenessBad: 7,
    restingHrWarn: 3,
    restingHrBad: 6,
    hrvWarnPct: 10,
    hrvBadPct: 20,
    includeKnee: false,
  },
  weightUnit: 'kg',
  distanceUnit: 'km',
  theme: 'system',
  trackKnee: true,
  tags: DEFAULT_TAGS,
  schemaVersion: SCHEMA_VERSION,
};
