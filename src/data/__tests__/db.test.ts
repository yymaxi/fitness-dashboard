import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FitnessDB } from '../db';
import { alive, dayId, getSettings, mergeSettings, save, softDelete, updateSettings } from '../repo';
import { DEMO_STAMP, generateDemoData, loadDemoData, removeDemoData } from '../demoData';
import type { Checkin } from '../../domain/types';

let db: FitnessDB;
let n = 0;
beforeEach(async () => {
  db = new FitnessDB(`test-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('Datenbank', () => {
  it('legt Standardübungen, Vorlagen und Einstellungen an', async () => {
    expect(await db.exercises.count()).toBe(12);
    expect((await db.templates.toArray()).map((t) => t.name).sort()).toEqual(['Pull', 'Push']);
    const s = await getSettings(db);
    expect(s.goals).toMatchObject({ sleepHours: 8, strengthPerWeek: 4, stepsPerDay: 10000 });
  });

  it('save setzt updatedAt und deleted; softDelete markiert nur', async () => {
    const rec = await save(db.checkins, {
      id: dayId.checkin('2026-11-06'), date: '2026-11-06', recovery: 7, soreness: 3, mood: 7,
      energy: 6, stress: 4, sleepQuality: 7, tags: [],
    } satisfies Omit<Checkin, 'updatedAt' | 'deleted'>, 1000);
    expect(rec).toMatchObject({ updatedAt: 1000, deleted: 0 });
    await softDelete(db.checkins, rec.id, 2000);
    const stored = await db.checkins.get(rec.id);
    expect(stored).toMatchObject({ deleted: 1, updatedAt: 2000 });
    expect(alive(await db.checkins.toArray())).toHaveLength(0);
  });

  it('Einstellungen: neue Felder werden ergänzt, Änderungen gespeichert', async () => {
    expect(mergeSettings({ goals: { sleepHours: 7 } } as never).goals.stepsPerDay).toBe(10000);
    await updateSettings({ theme: 'dark' }, db);
    expect((await getSettings(db)).theme).toBe('dark');
  });
});

describe('Demo-Daten', () => {
  it('sind reproduzierbar und plausibel', () => {
    const a = generateDemoData('2026-11-06');
    const b = generateDemoData('2026-11-06');
    expect(a).toEqual(b);
    expect(a.checkins).toHaveLength(60);
    expect(a.sleepNights.at(-1)?.date).toBe('2026-11-06');
    for (const n of a.sleepNights) {
      expect(n.asleepMin).toBeGreaterThanOrEqual(300);
      expect(n.asleepMin).toBeLessThan(11 * 60);
    }
    for (const c of a.checkins) {
      for (const v of [c.recovery, c.mood, c.energy, c.stress, c.soreness]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
    const strength = a.workouts.filter((w) => w.type === 'strength').length;
    expect(strength).toBeGreaterThan(25); // ~4 pro Woche über 8½ Wochen
    expect(a.workoutSets.every((s) => s.weightKg % 2.5 === 0)).toBe(true);
  });

  it('überschreibt keine echten Einträge und lässt sich wieder entfernen', async () => {
    await save(db.checkins, {
      id: dayId.checkin('2026-11-06'), date: '2026-11-06', recovery: 9, soreness: 1, mood: 9,
      energy: 9, stress: 1, sleepQuality: 9, tags: [],
    }, 5000);
    const added = await loadDemoData(db, '2026-11-06');
    expect(added).toBeGreaterThan(0);
    expect((await db.checkins.get('ci-2026-11-06'))?.recovery).toBe(9);
    expect(await db.checkins.where('updatedAt').equals(DEMO_STAMP).count()).toBe(59);

    await removeDemoData(db);
    expect(await db.checkins.count()).toBe(1);
    expect(await db.workouts.count()).toBe(0);
  });
});
