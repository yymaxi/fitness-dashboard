import type { Table } from 'dexie';
import type { FitnessDB } from '../data/db';
import { SCHEMA_VERSION } from '../data/defaults';
import { emptyTables, mergeTables, SNAPSHOT_TABLES, type Tables, type Versioned } from './merge';

/** Alle Datensätze aller Tabellen (inkl. Löschmarkierungen und Demo-Daten). */
export async function readTables(db: FitnessDB): Promise<Tables> {
  const out = emptyTables();
  await db.transaction('r', SNAPSHOT_TABLES.map((t) => db.table(t)), async () => {
    for (const t of SNAPSHOT_TABLES) out[t] = (await db.table(t).toArray()) as Versioned[];
  });
  return out;
}

/**
 * Schreibt Datensätze, die beim Zusammenführen gewonnen haben. Wurde ein
 * Datensatz inzwischen lokal noch neuer geändert, bleibt die lokale Version.
 */
export async function writeWinners(db: FitnessDB, toLocal: Tables): Promise<number> {
  let written = 0;
  const tables = SNAPSHOT_TABLES.filter((t) => toLocal[t].length > 0);
  if (tables.length === 0) return 0;
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const t of tables) {
      const table = db.table(t) as Table<Versioned, string>;
      const rows = toLocal[t];
      const current = await table.bulkGet(rows.map((r) => r.id));
      const fresh = rows.filter((r, i) => !current[i] || current[i]!.updatedAt <= r.updatedAt);
      await table.bulkPut(fresh);
      written += fresh.length;
    }
  });
  return written;
}

/** Gibt es lokale Änderungen seit `since` (ms)? Demo-Daten zählen nicht. */
export async function hasChangesSince(db: FitnessDB, since: number): Promise<boolean> {
  for (const t of SNAPSHOT_TABLES) {
    if (t === 'settings') {
      if (((await db.settings.get('settings'))?.updatedAt ?? 0) > since) return true;
    } else if ((await db.table(t).where('updatedAt').above(Math.max(since, 1)).count()) > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------- JSON-Backup

export const BACKUP_FORMAT = 'fitness-dashboard-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  schemaVersion: number;
  exportedAt: string;
  tables: Tables;
}

export async function createBackup(db: FitnessDB, now = new Date()): Promise<Backup> {
  return { format: BACKUP_FORMAT, version: 1, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), tables: await readTables(db) };
}

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  const b = data as Partial<Backup>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || !b.tables) {
    throw new Error('Die Datei ist kein Backup dieses Dashboards.');
  }
  if ((b.schemaVersion ?? 0) > SCHEMA_VERSION) {
    throw new Error('Das Backup stammt aus einer neueren App-Version. Bitte erst die App aktualisieren.');
  }
  const tables = emptyTables();
  for (const t of SNAPSHOT_TABLES) {
    const rows = (b.tables as Partial<Tables>)[t] ?? [];
    if (!Array.isArray(rows) || rows.some((r) => typeof r?.id !== 'string' || typeof r?.updatedAt !== 'number')) {
      throw new Error(`Tabelle „${t}“ im Backup ist beschädigt.`);
    }
    tables[t] = rows;
  }
  return { ...(b as Backup), tables };
}

export type RestoreMode = 'merge' | 'replace';

/**
 * Stellt ein Backup wieder her.
 * - merge: pro Datensatz gewinnt die neuere Änderung, nichts geht verloren.
 * - replace: lokale Daten werden vollständig durch das Backup ersetzt.
 */
export async function restoreBackup(db: FitnessDB, backup: Backup, mode: RestoreMode): Promise<number> {
  if (mode === 'replace') {
    let n = 0;
    await db.transaction('rw', SNAPSHOT_TABLES.map((t) => db.table(t)), async () => {
      for (const t of SNAPSHOT_TABLES) {
        await db.table(t).clear();
        await db.table(t).bulkPut(backup.tables[t]);
        n += backup.tables[t].length;
      }
    });
    return n;
  }
  const local = await readTables(db);
  // Beim Backup sollen auch Demo-Daten zurückkommen – sie sind nur vom Sync ausgenommen.
  const { toLocal } = mergeTables(local, backup.tables);
  for (const t of SNAPSHOT_TABLES) {
    const known = new Set(local[t].map((r) => r.id));
    toLocal[t].push(...backup.tables[t].filter((r) => r.updatedAt === 1 && !known.has(r.id)));
  }
  return writeWinners(db, toLocal);
}
