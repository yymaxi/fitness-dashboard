/**
 * Sync-Ablauf: Sync-Datei laden → entschlüsseln → pro Datensatz zusammenführen
 * → lokale Gewinner schreiben → (falls nötig) verschlüsselt hochladen.
 *
 * Gleichzeitige Änderungen zweier Geräte: Der Upload nutzt die zuletzt gelesene
 * Revision. Hat ein anderes Gerät dazwischen hochgeladen, schlägt er fehl und
 * der Ablauf beginnt neu – so geht nichts verloren.
 */
import Dexie, { type Table } from 'dexie';
import type { FitnessDB } from '../data/db';
import { decryptJson, deriveKey, DEFAULT_ITERATIONS, encryptJson, fromBase64, parseEnvelope, randomBytes, toBase64, type KeyInfo } from './crypto';
import { mergeTables, type Tables } from './merge';
import { readTables, writeWinners } from './snapshot';

export const SYNC_PATH = '/fitness-dashboard.sync';

export interface Remote {
  download(path: string): Promise<{ text: string; rev: string } | null>;
  upload(path: string, text: string, rev: string | null): Promise<string>;
}

/** Gerätelokaler Speicher (wird nicht synchronisiert): Schlüssel und Zeitpunkt des letzten Syncs. */
export interface DeviceStore {
  getKey(): Promise<KeyInfo | null>;
  setKey(k: KeyInfo | null): Promise<void>;
  getLastSync(): Promise<number>;
  setLastSync(ms: number): Promise<void>;
}

/** Die Sync-Datei wurde seit dem Lesen von einem anderen Gerät geändert. */
export class ConflictError extends Error {
  override name = 'ConflictError';
}

export class NeedsPasswordError extends Error {
  constructor(message = 'Bitte das Sync-Passwort eingeben.') {
    super(message);
  }
}

interface Payload {
  writtenAt: number;
  tables: Partial<Tables>;
}

export interface SyncResult {
  pulled: number;
  pushed: boolean;
}

/**
 * Passwort für dieses Gerät festlegen. Gibt es schon eine Sync-Datei, muss das
 * Passwort dazu passen (sonst WrongPasswordError).
 */
export async function setupPassword(remote: Remote, store: DeviceStore, password: string, iterations = DEFAULT_ITERATIONS): Promise<'joined' | 'created'> {
  const existing = await remote.download(SYNC_PATH);
  if (existing) {
    const env = parseEnvelope(existing.text);
    const key = await deriveKey(password, fromBase64(env.kdf.salt), env.kdf.iterations);
    await decryptJson(env, key); // wirft bei falschem Passwort
    await store.setKey({ key, salt: env.kdf.salt, iterations: env.kdf.iterations });
    return 'joined';
  }
  const salt = randomBytes(16);
  await store.setKey({ key: await deriveKey(password, salt, iterations), salt: toBase64(salt), iterations });
  return 'created';
}

export async function syncOnce(db: FitnessDB, remote: Remote, store: DeviceStore, now: () => number = Date.now): Promise<SyncResult> {
  const key = await store.getKey();
  if (!key) throw new NeedsPasswordError();

  let pulled = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const startedAt = now();
    const file = await remote.download(SYNC_PATH);
    let remoteTables: Partial<Tables> | null = null;
    if (file) {
      const env = parseEnvelope(file.text);
      if (env.kdf.salt !== key.salt || env.kdf.iterations !== key.iterations) {
        await store.setKey(null);
        throw new NeedsPasswordError('Die Sync-Datei wurde neu angelegt. Bitte das Passwort erneut eingeben.');
      }
      remoteTables = (await decryptJson<Payload>(env, key.key)).tables;
    }

    const local = await readTables(db);
    const m = mergeTables(local, remoteTables);
    pulled += await writeWinners(db, m.toLocal);

    if (!m.remoteOutdated) {
      await store.setLastSync(startedAt);
      return { pulled, pushed: false };
    }
    const text = await encryptJson({ writtenAt: startedAt, tables: m.merged } satisfies Payload, key);
    try {
      await remote.upload(SYNC_PATH, text, file?.rev ?? null);
    } catch (err) {
      if (err instanceof ConflictError) continue;
      throw err;
    }
    await store.setLastSync(startedAt);
    return { pulled, pushed: true };
  }
  throw new Error('Sync-Datei wird gerade von einem anderen Gerät geändert. Bitte gleich nochmal versuchen.');
}

// ---------------------------------------------------------------- Gerätespeicher (IndexedDB)

interface KV {
  id: string;
  value: unknown;
}

class DeviceDB extends Dexie {
  kv!: Table<KV, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ kv: 'id' });
  }
}

/** Der Schlüssel liegt als nicht exportierbarer CryptoKey in IndexedDB – das Passwort selbst wird nie gespeichert. */
export function createDeviceStore(name = 'fitness-dashboard-device'): DeviceStore {
  const d = new DeviceDB(name);
  return {
    getKey: async () => ((await d.kv.get('syncKey'))?.value as KeyInfo | undefined) ?? null,
    setKey: async (k) => {
      if (k) await d.kv.put({ id: 'syncKey', value: k });
      else await d.kv.delete('syncKey');
    },
    getLastSync: async () => ((await d.kv.get('lastSync'))?.value as number | undefined) ?? 0,
    setLastSync: async (ms) => {
      await d.kv.put({ id: 'lastSync', value: ms });
    },
  };
}
