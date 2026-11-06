import type { DailyVitals, SleepNight, SyncMeta, Workout } from '../domain/types';
import type { FitnessDB } from '../data/db';
import type { HealthImport } from './health';

export interface ImportCounts {
  added: number;
  updated: number;
  /** Bereits vorhanden und unverändert bzw. schon importiert. */
  unchanged: number;
  /** Von dir gelöscht – wird nicht wiederhergestellt. */
  skipped: number;
}

export interface ImportSummary {
  sleepNights: ImportCounts;
  dailyVitals: ImportCounts;
  workouts: ImportCounts;
}

const zero = (): ImportCounts => ({ added: 0, updated: 0, unchanged: 0, skipped: 0 });

function content(r: object): string {
  const { updatedAt: _u, deleted: _d, ...rest } = r as SyncMeta;
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, (rest as Record<string, unknown>)[k]]));
}

type Decision<T> = { kind: 'add' | 'update'; record: T } | { kind: 'unchanged' | 'skipped' };

/**
 * Nacht: Importierte Werte ersetzen manuelle Schätzungen (aus dem Check-in) und
 * Demo-Daten. Von dir gelöschte Nächte bleiben gelöscht.
 */
export function decideNight(existing: SleepNight | undefined, incoming: Omit<SleepNight, 'updatedAt' | 'deleted'>, now: number): Decision<SleepNight> {
  const record: SleepNight = { ...incoming, updatedAt: now, deleted: 0 };
  if (!existing) return { kind: 'add', record };
  if (existing.deleted === 1) return { kind: 'skipped' };
  if (content(existing) === content(record)) return { kind: 'unchanged' };
  return { kind: 'update', record };
}

/** Tageswerte: Felder eines früheren Imports bleiben erhalten, neue Werte überschreiben. */
export function decideVitals(existing: DailyVitals | undefined, incoming: Omit<DailyVitals, 'updatedAt' | 'deleted'>, now: number): Decision<DailyVitals> {
  if (existing?.deleted === 1) return { kind: 'skipped' };
  const base = existing && existing.source === 'apple-health' ? existing : undefined;
  const record: DailyVitals = { ...base, ...incoming, updatedAt: now, deleted: 0 };
  if (!existing) return { kind: 'add', record };
  if (content(existing) === content(record)) return { kind: 'unchanged' };
  return { kind: 'update', record };
}

/** Schreibt einen Import in die Datenbank. Ändert updatedAt nur bei echten Änderungen (wichtig für den Sync). */
export async function applyHealthImport(db: FitnessDB, data: HealthImport, now: number = Date.now()): Promise<ImportSummary> {
  const summary: ImportSummary = { sleepNights: zero(), dailyVitals: zero(), workouts: zero() };

  await db.transaction('rw', db.sleepNights, db.dailyVitals, db.workouts, async () => {
    const nights = await db.sleepNights.bulkGet(data.sleepNights.map((n) => n.id));
    const nightWrites: SleepNight[] = [];
    data.sleepNights.forEach((n, i) => {
      const d = decideNight(nights[i], n, now);
      summary.sleepNights[d.kind === 'add' ? 'added' : d.kind === 'update' ? 'updated' : d.kind]++;
      if (d.kind === 'add' || d.kind === 'update') nightWrites.push(d.record);
    });
    await db.sleepNights.bulkPut(nightWrites);

    const vitals = await db.dailyVitals.bulkGet(data.dailyVitals.map((v) => v.id));
    const vitalWrites: DailyVitals[] = [];
    data.dailyVitals.forEach((v, i) => {
      const d = decideVitals(vitals[i], v, now);
      summary.dailyVitals[d.kind === 'add' ? 'added' : d.kind === 'update' ? 'updated' : d.kind]++;
      if (d.kind === 'add' || d.kind === 'update') vitalWrites.push(d.record);
    });
    await db.dailyVitals.bulkPut(vitalWrites);

    // Workouts nur neu anlegen: einmal importierte Einheiten darfst du frei bearbeiten (RPE, Notiz …)
    const known = new Set<string>();
    const ids = data.workouts.map((w) => w.externalId!).filter(Boolean);
    await db.workouts.where('externalId').anyOf(ids).each((w) => known.add(w.externalId!));
    for (const w of await db.workouts.bulkGet(data.workouts.map((w) => w.id))) if (w) known.add(w.externalId ?? w.id);
    const workoutWrites: Workout[] = [];
    for (const w of data.workouts) {
      if (known.has(w.externalId!)) summary.workouts.unchanged++;
      else {
        known.add(w.externalId!);
        workoutWrites.push({ ...w, updatedAt: now, deleted: 0 });
        summary.workouts.added++;
      }
    }
    await db.workouts.bulkPut(workoutWrites);
  });

  return summary;
}
