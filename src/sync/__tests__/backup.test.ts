import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FitnessDB } from '../../data/db';
import { dayId, save } from '../../data/repo';
import { loadDemoData } from '../../data/demoData';
import { createBackup, hasChangesSince, parseBackup, restoreBackup } from '../snapshot';

let dbs: FitnessDB[] = [];
let n = 0;
async function open() {
  const db = new FitnessDB(`backup-${n++}`);
  await db.open();
  dbs.push(db);
  return db;
}
beforeEach(() => {
  dbs = [];
});
afterEach(async () => {
  for (const d of dbs) await d.delete();
});

const checkin = (date: string, recovery: number) => ({
  id: dayId.checkin(date), date, recovery, soreness: 3, mood: 7, energy: 6, stress: 4, sleepQuality: 7, tags: [],
});

describe('JSON-Backup', () => {
  it('Backup → Wiederherstellen auf leerem Gerät ergibt denselben Stand', async () => {
    const a = await open();
    await save(a.checkins, checkin('2026-11-05', 6), 1000);
    await loadDemoData(a, '2026-11-06');
    const backup = parseBackup(JSON.stringify(await createBackup(a)));

    const b = await open();
    await restoreBackup(b, backup, 'merge');
    expect(await b.checkins.count()).toBe(await a.checkins.count());
    expect(await b.workouts.count()).toBe(await a.workouts.count());
    expect((await b.checkins.get('ci-2026-11-05'))?.recovery).toBe(6);
  });

  it('Zusammenführen behält neuere lokale Änderungen, Ersetzen nicht', async () => {
    const a = await open();
    await save(a.checkins, checkin('2026-11-05', 6), 1000);
    const backup = await createBackup(a);
    await save(a.checkins, checkin('2026-11-05', 9), 2000);
    await save(a.checkins, checkin('2026-11-06', 7), 2000);

    await restoreBackup(a, backup, 'merge');
    expect((await a.checkins.get('ci-2026-11-05'))?.recovery).toBe(9);
    await restoreBackup(a, backup, 'replace');
    expect((await a.checkins.get('ci-2026-11-05'))?.recovery).toBe(6);
    expect(await a.checkins.get('ci-2026-11-06')).toBeUndefined();
  });

  it('lehnt fremde oder beschädigte Dateien ab', () => {
    expect(() => parseBackup('kein json')).toThrow(/JSON/);
    expect(() => parseBackup('{"foo":1}')).toThrow(/kein Backup/);
    expect(() => parseBackup(JSON.stringify({ format: 'fitness-dashboard-backup', schemaVersion: 1, tables: { todos: [{ id: 1 }] } }))).toThrow(/todos/);
    expect(() => parseBackup(JSON.stringify({ format: 'fitness-dashboard-backup', schemaVersion: 99, tables: {} }))).toThrow(/neueren/);
  });

  it('erkennt lokale Änderungen seit dem letzten Sync, Demo-Daten zählen nicht', async () => {
    const a = await open();
    await loadDemoData(a, '2026-11-06');
    expect(await hasChangesSince(a, 500)).toBe(false);
    await save(a.todos, { id: 't', title: 'x', priority: 'mittel', category: 'Alltag', done: 0 }, 600);
    expect(await hasChangesSince(a, 500)).toBe(true);
    expect(await hasChangesSince(a, 600)).toBe(false);
  });
});
