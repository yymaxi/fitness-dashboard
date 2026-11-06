import type { Table } from 'dexie';
import type { Settings, SyncMeta } from '../domain/types';
import { db, type FitnessDB } from './db';
import { DEFAULT_SETTINGS } from './defaults';

export function newId(): string {
  return crypto.randomUUID();
}

/** Stabile IDs für „ein Datensatz pro Tag“ – Handy und PC erzeugen dieselbe ID. */
export const dayId = {
  checkin: (date: string) => `ci-${date}`,
  sleep: (date: string) => `sl-${date}`,
  vitals: (date: string) => `vt-${date}`,
};

type WithoutMeta<T extends SyncMeta> = Omit<T, 'updatedAt' | 'deleted'> & Partial<Pick<T, 'deleted'>>;

/** Speichert einen Datensatz und setzt den Änderungszeitpunkt. */
export async function save<T extends SyncMeta>(
  table: Table<T, string>,
  record: WithoutMeta<T>,
  now: number = Date.now(),
): Promise<T> {
  const full = { deleted: 0, ...record, updatedAt: now } as T;
  await table.put(full);
  return full;
}

export async function saveMany<T extends SyncMeta>(
  table: Table<T, string>,
  records: WithoutMeta<T>[],
  now: number = Date.now(),
): Promise<void> {
  await table.bulkPut(records.map((r) => ({ deleted: 0, ...r, updatedAt: now }) as T));
}

/** Löschen = Markierung setzen, damit die Löschung auch auf andere Geräte synchronisiert. */
export async function softDelete<T extends SyncMeta>(
  table: Table<T, string>,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await table.update(id, { deleted: 1, updatedAt: now } as never);
}

export function alive<T extends SyncMeta>(rows: T[]): T[] {
  return rows.filter((r) => r.deleted !== 1);
}

/** Einstellungen laden; neue Felder späterer Versionen werden mit Standardwerten ergänzt. */
export async function getSettings(database: FitnessDB = db): Promise<Settings> {
  const stored = await database.settings.get('settings');
  return mergeSettings(stored);
}

export function mergeSettings(stored?: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    goals: { ...DEFAULT_SETTINGS.goals, ...stored?.goals },
    readiness: { ...DEFAULT_SETTINGS.readiness, ...stored?.readiness },
    id: 'settings',
  };
}

export async function updateSettings(patch: Partial<Settings>, database: FitnessDB = db): Promise<void> {
  const current = await getSettings(database);
  await database.settings.put({ ...current, ...patch, id: 'settings', updatedAt: Date.now() });
}
