import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FitnessDB } from '../../data/db';
import { save, softDelete } from '../../data/repo';
import { loadDemoData } from '../../data/demoData';
import { applyHealthImport } from '../applyImport';
import type { HealthImport } from '../health';

let db: FitnessDB;
let n = 0;
beforeEach(async () => {
  db = new FitnessDB(`import-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const data = (): HealthImport => ({
  sleepNights: [
    { id: 'sl-2026-11-06', date: '2026-11-06', bedtime: '23:10', wakeTime: '06:40', asleepMin: 430, deepMin: 80, source: 'apple-health' },
  ],
  dailyVitals: [{ id: 'vt-2026-11-06', date: '2026-11-06', steps: 8500, stepsSource: 'Zepp', hrvSdnnMs: 52, source: 'apple-health' }],
  workouts: [
    { id: 'wo-ah-0000aaaa', externalId: 'apple-health|Zepp|Running|1', date: '2026-11-05', type: 'cardio', label: 'Laufen', durationMin: 30, source: 'apple-health' },
  ],
});

describe('applyHealthImport', () => {
  it('legt beim ersten Import alles an, ein zweiter Import ändert nichts', async () => {
    const first = await applyHealthImport(db, data(), 1000);
    expect(first.sleepNights.added).toBe(1);
    expect(first.dailyVitals.added).toBe(1);
    expect(first.workouts.added).toBe(1);

    const second = await applyHealthImport(db, data(), 2000);
    expect(second.sleepNights).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect(second.workouts).toMatchObject({ added: 0, unchanged: 1 });
    // updatedAt bleibt, damit der Sync nichts Unverändertes hochlädt
    expect((await db.sleepNights.get('sl-2026-11-06'))?.updatedAt).toBe(1000);
    expect(await db.workouts.count()).toBe(1);
  });

  it('erkennt Workouts per externalId, auch bearbeitet oder gelöscht', async () => {
    await applyHealthImport(db, data(), 1000);
    await db.workouts.update('wo-ah-0000aaaa', { rpe: 7, updatedAt: 1500 });
    await applyHealthImport(db, data(), 2000);
    expect((await db.workouts.get('wo-ah-0000aaaa'))?.rpe).toBe(7);

    await softDelete(db.workouts, 'wo-ah-0000aaaa', 2500);
    const r = await applyHealthImport(db, data(), 3000);
    expect(r.workouts.added).toBe(0);
    expect((await db.workouts.get('wo-ah-0000aaaa'))?.deleted).toBe(1);

    // gleiche externalId unter anderer ID (z. B. älterer Import) → kein Duplikat
    await db.workouts.clear();
    await save(db.workouts, { ...data().workouts[0]!, id: 'other-id' }, 100);
    expect((await applyHealthImport(db, data(), 4000)).workouts.added).toBe(0);
  });

  it('ersetzt manuelle Schätzung und Demo-Nacht, lässt gelöschte Nächte in Ruhe', async () => {
    await save(db.sleepNights, { id: 'sl-2026-11-06', date: '2026-11-06', bedtime: '23:00', wakeTime: '07:00', asleepMin: 480, source: 'manual' }, 500);
    expect((await applyHealthImport(db, data(), 1000)).sleepNights.updated).toBe(1);
    expect((await db.sleepNights.get('sl-2026-11-06'))?.asleepMin).toBe(430);

    await softDelete(db.sleepNights, 'sl-2026-11-06', 1500);
    const changed = { ...data(), sleepNights: [{ ...data().sleepNights[0]!, asleepMin: 400 }] };
    expect((await applyHealthImport(db, changed, 2000)).sleepNights.skipped).toBe(1);
    expect((await db.sleepNights.get('sl-2026-11-06'))?.deleted).toBe(1);

    await loadDemoData(db, '2026-11-07');
    expect((await db.sleepNights.get('sl-2026-11-07'))?.source).toBe('demo');
    const demoNight = { ...data().sleepNights[0]!, id: 'sl-2026-11-07', date: '2026-11-07' };
    await applyHealthImport(db, { ...data(), sleepNights: [demoNight] }, 3000);
    expect(await db.sleepNights.get('sl-2026-11-07')).toMatchObject({ source: 'apple-health', updatedAt: 3000 });
  });

  it('Tageswerte: neue Felder ergänzen frühere Importe', async () => {
    await applyHealthImport(db, data(), 1000);
    const onlyRhr: HealthImport = { sleepNights: [], workouts: [], dailyVitals: [{ id: 'vt-2026-11-06', date: '2026-11-06', restingHr: 52, source: 'apple-health' }] };
    expect((await applyHealthImport(db, onlyRhr, 2000)).dailyVitals.updated).toBe(1);
    expect(await db.dailyVitals.get('vt-2026-11-06')).toMatchObject({ steps: 8500, hrvSdnnMs: 52, restingHr: 52, updatedAt: 2000 });
  });
});
