/**
 * Zusammenführen von Datenständen (Sync und Backup-Wiederherstellung).
 *
 * Regel pro Datensatz: die neuere Änderung (`updatedAt`) gewinnt. Löschungen
 * sind Datensätze mit `deleted = 1` und setzen sich dadurch ebenfalls durch.
 * Bei exakt gleichem Zeitstempel entscheidet der Inhalt deterministisch, damit
 * zwei Geräte nicht endlos hin- und herschreiben.
 *
 * Demo-Daten (`updatedAt = 1`) werden nie hochgeladen. Ein echter Eintrag mit
 * derselben Tages-ID gewinnt immer gegen einen Demo-Eintrag.
 */
import { DEMO_STAMP } from '../data/demoData';
import { SYNC_TABLES } from '../data/db';

export interface Versioned {
  id: string;
  updatedAt: number;
}

export const SNAPSHOT_TABLES = [...SYNC_TABLES, 'settings'] as const;
export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];
export type Tables = Record<SnapshotTable, Versioned[]>;

export function emptyTables(): Tables {
  return Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, []])) as unknown as Tables;
}

export const isDemo = (r: Versioned) => r.updatedAt === DEMO_STAMP;

function stable(r: unknown): string {
  return JSON.stringify(r, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export interface TableMerge<T extends Versioned> {
  /** Stand für die Sync-Datei (ohne Demo-Daten). */
  merged: T[];
  /** Datensätze, die lokal geschrieben werden müssen. */
  toLocal: T[];
  /** Die Sync-Datei weicht vom zusammengeführten Stand ab. */
  remoteOutdated: boolean;
}

export function mergeTable<T extends Versioned>(local: T[], remote: T[]): TableMerge<T> {
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteById = new Map<string, T>();
  for (const r of remote) if (!isDemo(r)) remoteById.set(r.id, r);

  const merged: T[] = [];
  const toLocal: T[] = [];
  let remoteOutdated = false;

  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    let fromLocal: boolean;
    if (l && r) {
      if (l.updatedAt !== r.updatedAt) fromLocal = l.updatedAt > r.updatedAt;
      else {
        const sl = stable(l);
        const sr = stable(r);
        if (sl === sr) {
          if (!isDemo(l)) merged.push(l);
          continue;
        }
        fromLocal = sl > sr;
      }
    } else fromLocal = !!l;
    const winner = (fromLocal ? l : r)!;
    if (!fromLocal) toLocal.push(winner);
    if (isDemo(winner)) continue; // nur lokal vorhanden, bleibt lokal
    merged.push(winner);
    if (fromLocal) remoteOutdated = true;
  }
  return { merged, toLocal, remoteOutdated };
}

export interface SnapshotMerge {
  merged: Tables;
  toLocal: Tables;
  remoteOutdated: boolean;
  /** Anzahl lokal übernommener Datensätze. */
  pulled: number;
}

export function mergeTables(local: Tables, remote: Partial<Tables> | null): SnapshotMerge {
  const merged = emptyTables();
  const toLocal = emptyTables();
  let remoteOutdated = remote === null;
  let pulled = 0;
  for (const t of SNAPSHOT_TABLES) {
    const m = mergeTable(local[t] ?? [], remote?.[t] ?? []);
    merged[t] = m.merged;
    toLocal[t] = m.toLocal;
    pulled += m.toLocal.length;
    remoteOutdated ||= m.remoteOutdated;
  }
  return { merged, toLocal, remoteOutdated, pulled };
}
