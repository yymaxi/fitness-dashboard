import { describe, expect, it } from 'vitest';
import { emptyTables, mergeTable, mergeTables } from '../merge';

const r = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({ id, updatedAt, deleted: 0 as 0 | 1, ...extra });

describe('mergeTable', () => {
  it('neuere Änderung gewinnt pro Datensatz', () => {
    const local = [r('a', 10, { v: 'lokal' }), r('b', 30, { v: 'lokal' })];
    const remote = [r('a', 20, { v: 'remote' }), r('b', 25, { v: 'remote' }), r('c', 5)];
    const m = mergeTable(local, remote);
    expect(Object.fromEntries(m.merged.map((x) => [x.id, x.updatedAt]))).toEqual({ a: 20, b: 30, c: 5 });
    expect(m.toLocal.map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect(m.remoteOutdated).toBe(true); // b ist lokal neuer
  });

  it('Löschungen setzen sich durch, wenn sie neuer sind', () => {
    const m = mergeTable([r('a', 10)], [{ ...r('a', 20), deleted: 1 as const }]);
    expect(m.toLocal).toEqual([{ id: 'a', updatedAt: 20, deleted: 1 }]);
  });

  it('gleicher Stand: nichts zu tun', () => {
    const remote: ReturnType<typeof r>[] = [JSON.parse('{"w":[1,2],"v":1,"id":"a","updatedAt":10,"deleted":0}')];
    const m = mergeTable([r('a', 10, { v: 1, w: [1, 2] })], remote);
    expect(m.toLocal).toEqual([]);
    expect(m.remoteOutdated).toBe(false);
  });

  it('gleicher Zeitstempel, anderer Inhalt: beide Geräte entscheiden gleich', () => {
    const x = r('a', 10, { v: 'x' });
    const y = r('a', 10, { v: 'y' });
    const onA = mergeTable([x], [y]);
    const onB = mergeTable([y], [x]);
    expect(onA.merged).toEqual(onB.merged);
  });

  it('Demo-Daten (updatedAt = 1) werden nicht hochgeladen und verlieren gegen echte Einträge', () => {
    const local = [r('ci-2026-11-05', 1, { demo: true }), r('ci-2026-11-06', 1, { demo: true }), r('ci-2026-11-04', 500)];
    const remote = [r('ci-2026-11-05', 100, { demo: false })];
    const m = mergeTable(local, remote);
    expect(m.merged.map((x) => x.id).sort()).toEqual(['ci-2026-11-04', 'ci-2026-11-05']);
    expect(m.toLocal).toEqual([r('ci-2026-11-05', 100, { demo: false })]);
    // Demo-Eintrag allein macht die Sync-Datei nicht „veraltet“
    expect(mergeTable([r('x', 1)], []).remoteOutdated).toBe(false);
    // falls doch Demo-Daten in der Datei stünden, werden sie ignoriert
    expect(mergeTable([], [r('x', 1)]).toLocal).toEqual([]);
  });
});

describe('mergeTables', () => {
  it('ohne Sync-Datei wird alles hochgeladen', () => {
    const local = emptyTables();
    local.todos = [r('t1', 5)];
    local.settings = [r('settings', 0)];
    const m = mergeTables(local, null);
    expect(m.remoteOutdated).toBe(true);
    expect(m.merged.todos).toHaveLength(1);
    expect(m.pulled).toBe(0);
  });

  it('fehlende Tabellen in der Sync-Datei sind kein Fehler', () => {
    const local = emptyTables();
    local.checkins = [r('c', 3)];
    const m = mergeTables(local, { todos: [r('t', 4)] });
    expect(m.toLocal.todos).toHaveLength(1);
    expect(m.merged.checkins).toHaveLength(1);
    expect(m.pulled).toBe(1);
  });
});
