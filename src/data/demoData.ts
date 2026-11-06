import type {
  BodyMetric,
  Checkin,
  DailyVitals,
  ISODate,
  SleepNight,
  Todo,
  Workout,
  WorkoutSet,
} from '../domain/types';
import { addDays, fromISODate, minutesToHHMM } from '../domain/dates';
import { clampScale } from '../domain/checkin';
import { createRng } from '../domain/random';
import { DEFAULT_TEMPLATES } from './defaults';
import { dayId } from './repo';
import type { FitnessDB } from './db';

/**
 * Demo-Datensätze tragen updatedAt = 1. Daran erkennt die App sie wieder
 * (zum Entfernen) und sie verlieren bei jedem Abgleich gegen echte Daten.
 */
export const DEMO_STAMP = 1;

export interface DemoData {
  checkins: Checkin[];
  sleepNights: SleepNight[];
  dailyVitals: DailyVitals[];
  workouts: Workout[];
  workoutSets: WorkoutSet[];
  bodyMetrics: BodyMetric[];
  todos: Todo[];
}

const BASE_WEIGHT: Record<string, number> = {
  'ex-bench': 70,
  'ex-incline-db': 26,
  'ex-ohp': 40,
  'ex-lateral': 10,
  'ex-fly': 50,
  'ex-pushdown': 25,
  'ex-latpull': 60,
  'ex-cablerow': 55,
  'ex-bbrow': 60,
  'ex-facepull': 20,
  'ex-curl': 14,
  'ex-hammer': 16,
};

const meta = { updatedAt: DEMO_STAMP, deleted: 0 as const };
const round25 = (kg: number) => Math.round(kg / 2.5) * 2.5;

/** Erzeugt `days` Tage realistischer Beispieldaten bis einschließlich `endDate`. */
export function generateDemoData(endDate: ISODate, days = 60, seed = 42): DemoData {
  const rng = createRng(seed);
  const out: DemoData = {
    checkins: [],
    sleepNights: [],
    dailyVitals: [],
    workouts: [],
    workoutSets: [],
    bodyMetrics: [],
    todos: [],
  };
  const push = DEFAULT_TEMPLATES[0]!;
  const pull = DEFAULT_TEMPLATES[1]!;
  let prevType: Workout['type'] | null = null;
  let prevRun = false;

  for (let i = 0; i < days; i++) {
    const date = addDays(endDate, i - days + 1);
    const weekday = (fromISODate(date).getDay() + 6) % 7; // Mo = 0
    const weekend = weekday >= 5;
    const progress = i / days;

    // Abend vorher: Tags beeinflussen die Nacht
    const tags: string[] = [];
    if (rng.chance(weekend ? 0.25 : 0.07)) tags.push('Alkohol');
    if (rng.chance(0.2)) tags.push('Bildschirm vor dem Schlaf');
    if (rng.chance(0.1)) tags.push('spät gegessen');
    const penalty = (tags.includes('Alkohol') ? 45 : 0) + (tags.includes('Bildschirm vor dem Schlaf') ? 15 : 0);

    // Schlaf
    const bed = rng.normal(23 * 60 + 40 + (weekend ? 50 : 0), 35);
    const asleep = Math.max(300, Math.round(rng.normal(445, 40) - penalty));
    const awake = Math.round(rng.range(8, 30));
    const deep = Math.round(asleep * rng.range(0.14, 0.22));
    const rem = Math.round(asleep * rng.range(0.18, 0.25));
    out.sleepNights.push({
      id: dayId.sleep(date),
      date,
      bedtime: minutesToHHMM(bed),
      wakeTime: minutesToHHMM(bed + asleep + awake),
      asleepMin: asleep,
      deepMin: deep,
      remMin: rem,
      coreMin: asleep - deep - rem,
      awakeMin: awake,
      source: 'demo',
      ...meta,
    });
    const sleepH = asleep / 60;

    // Training des Tages
    let type: Workout['type'] | null = null;
    let templateId: string | undefined;
    let label: string | undefined;
    if (!rng.chance(0.1)) {
      if (weekday === 0 || weekday === 3) [type, templateId] = ['strength', push.id];
      else if (weekday === 1 || weekday === 4) [type, templateId] = ['strength', pull.id];
      else if (weekday === 2 || (weekday === 6 && rng.chance(0.8))) [type, label] = ['mobility', 'Dehnen'];
      else if (weekday === 5 && rng.chance(0.7)) [type, label] = ['cardio', 'Laufen'];
    }

    // Vitalwerte
    const restingHr = Math.round(rng.normal(45, 1) + (tags.includes('Alkohol') ? 3 : 0) + (sleepH < 6.5 ? 2 : 0));
    const hrv = Math.round(rng.normal(82, 6) - (tags.includes('Alkohol') ? 15 : 0) - (sleepH < 6.5 ? 8 : 0));
    const steps = Math.round(Math.max(1500, rng.normal(type === 'cardio' ? 13000 : 8500, 2400)));
    out.dailyVitals.push({
      id: dayId.vitals(date),
      date,
      restingHr,
      hrvSdnnMs: hrv,
      steps,
      stepsSource: 'demo',
      source: 'demo',
      ...meta,
    });

    // Check-in (Tagesform hängt am Schlaf und am Vortag)
    const soreness = clampScale(rng.normal(prevType === 'strength' ? 5 : 2.5, 1.2));
    const recovery = clampScale(rng.normal(sleepH - 0.5 - (soreness > 5 ? 1 : 0), 1));
    out.checkins.push({
      id: dayId.checkin(date),
      date,
      sleepQuality: clampScale(rng.normal(sleepH - 0.8, 1)),
      recovery,
      soreness,
      energy: clampScale(rng.normal(sleepH - 0.5, 1.2)),
      mood: clampScale(rng.normal(6.5 + (weekend ? 0.5 : 0), 1.2)),
      stress: clampScale(rng.normal(weekend ? 3 : 5, 1.5)),
      kneePain: clampScale(rng.normal(1 + (prevRun ? 2 : 0), 0.8), 0, 10),
      tags,
      note: undefined,
      ...meta,
    });

    if (type) {
      const workoutId = `demo-w-${date}`;
      out.workouts.push({
        id: workoutId,
        date,
        start: type === 'strength' ? '17:30' : '18:00',
        type,
        label,
        templateId,
        durationMin: type === 'strength' ? rng.int(55, 75) : type === 'cardio' ? rng.int(25, 40) : rng.int(15, 25),
        rpe: type === 'mobility' ? undefined : rng.int(6, 9),
        distanceKm: type === 'cardio' ? Math.round(rng.range(3.5, 6) * 10) / 10 : undefined,
        avgHr: type === 'cardio' ? rng.int(145, 160) : undefined,
        source: 'demo',
        ...meta,
      });
      if (templateId) {
        const tpl = templateId === push.id ? push : pull;
        let order = 0;
        for (const exerciseId of tpl.exerciseIds) {
          const base = (BASE_WEIGHT[exerciseId] ?? 20) * (1 + progress * 0.07);
          for (let s = 0; s < 3; s++) {
            out.workoutSets.push({
              id: `demo-s-${date}-${order}`,
              workoutId,
              exerciseId,
              order: order++,
              reps: rng.int(8, 12) - s,
              weightKg: round25(base),
              warmup: 0,
              ...meta,
            });
          }
        }
      }
    }

    if (i % 3 === 0) {
      out.bodyMetrics.push({
        id: `demo-b-${date}`,
        date,
        weightKg: Math.round(rng.normal(79 - progress * 1.2, 0.3) * 10) / 10,
        source: 'demo',
        ...meta,
      });
    }

    prevType = type;
    prevRun = type === 'cardio';
  }

  const todo = (id: string, t: Partial<Todo> & Pick<Todo, 'title'>): Todo => ({
    id: `demo-t-${id}`,
    priority: 'mittel',
    category: 'Sonstiges',
    done: 0,
    ...meta,
    ...t,
  });
  out.todos.push(
    todo('1', { title: 'Push-Training', category: 'Training', due: addDays(endDate, 1), plannedTemplateId: push.id, priority: 'hoch' }),
    todo('2', { title: 'Proteinpulver nachkaufen', category: 'Ernährung', due: addDays(endDate, 3) }),
    todo('3', { title: 'Neue Laufschuhe ansehen', category: 'Training', priority: 'niedrig' }),
    todo('4', { title: 'Steuerunterlagen sortieren', category: 'Alltag', due: addDays(endDate, -1), priority: 'hoch' }),
  );
  return out;
}

const DEMO_TABLES = ['checkins', 'sleepNights', 'dailyVitals', 'workouts', 'workoutSets', 'bodyMetrics', 'todos'] as const;

/** Lädt Demo-Daten, ohne vorhandene echte Einträge zu überschreiben. */
export async function loadDemoData(database: FitnessDB, endDate: ISODate): Promise<number> {
  const data = generateDemoData(endDate);
  let added = 0;
  await database.transaction('rw', DEMO_TABLES.map((t) => database.table(t)), async () => {
    for (const name of DEMO_TABLES) {
      const table = database.table(name);
      const rows = data[name] as { id: string }[];
      const existing = new Set((await table.bulkGet(rows.map((r) => r.id))).filter(Boolean).map((r) => (r as { id: string }).id));
      const fresh = rows.filter((r) => !existing.has(r.id));
      await table.bulkAdd(fresh);
      added += fresh.length;
    }
  });
  return added;
}

/** Entfernt alle unveränderten Demo-Einträge. Von dir bearbeitete Einträge bleiben erhalten. */
export async function removeDemoData(database: FitnessDB): Promise<number> {
  let removed = 0;
  await database.transaction('rw', DEMO_TABLES.map((t) => database.table(t)), async () => {
    for (const name of DEMO_TABLES) {
      removed += await database.table(name).where('updatedAt').equals(DEMO_STAMP).delete();
    }
  });
  return removed;
}
