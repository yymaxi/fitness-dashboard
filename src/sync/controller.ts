/**
 * Steuert den Dropbox-Sync in der App: Status für die Oberfläche und
 * automatischer Abgleich (beim Start, beim Zurückkehren zur App und nach
 * lokalen Änderungen).
 */
import { useSyncExternalStore } from 'react';
import { db } from '../data/db';
import { WrongPasswordError } from './crypto';
import { completeDropboxAuth, disconnectDropbox, downloadFile, isConnected, uploadFile } from './dropbox';
import { createDeviceStore, NeedsPasswordError, setupPassword, syncOnce, type Remote } from './engine';
import { hasChangesSince } from './snapshot';

export interface SyncState {
  connected: boolean;
  hasKey: boolean;
  running: boolean;
  lastSync: number;
  error: string | null;
  /** Kurze Rückmeldung zum letzten Lauf. */
  info: string | null;
}

const remote: Remote = { download: downloadFile, upload: uploadFile };
const store = createDeviceStore();

let state: SyncState = { connected: false, hasKey: false, running: false, lastSync: 0, error: null, info: null };
const listeners = new Set<() => void>();
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

async function refresh() {
  set({ connected: isConnected(), hasKey: (await store.getKey()) !== null, lastSync: await store.getLastSync() });
}

let pending: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    await refresh();
    if (!state.connected || !state.hasKey) return;
    set({ running: true, error: null });
    try {
      const r = await syncOnce(db, remote, store);
      set({ info: r.pulled ? `${r.pulled} Änderungen übernommen` : r.pushed ? 'Änderungen hochgeladen' : 'Alles aktuell' });
    } catch (err) {
      if (err instanceof NeedsPasswordError) await store.setKey(null);
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      await refresh();
      set({ running: false });
      pending = null;
    }
  })();
  return pending;
}

export async function setSyncPassword(password: string): Promise<void> {
  set({ running: true, error: null });
  try {
    const mode = await setupPassword(remote, store, password);
    set({ info: mode === 'joined' ? 'Mit bestehenden Sync-Daten verbunden' : 'Neue Sync-Datei angelegt' });
  } catch (err) {
    set({ running: false, error: err instanceof WrongPasswordError ? err.message : err instanceof Error ? err.message : String(err) });
    return;
  }
  set({ running: false });
  await syncNow();
}

export async function disconnect(): Promise<void> {
  await disconnectDropbox();
  await store.setKey(null);
  await store.setLastSync(0);
  set({ info: null, error: null });
  await refresh();
}

const MIN_INTERVAL = 60_000;
let started = false;

/** Einmal beim App-Start aufrufen. */
export async function initSync(): Promise<void> {
  if (started) return;
  started = true;
  try {
    if (await completeDropboxAuth()) set({ info: 'Dropbox verbunden – jetzt ein Sync-Passwort festlegen.' });
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  }
  await refresh();
  void syncNow();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastSync > MIN_INTERVAL) void syncNow();
  });
  // Lokale Änderungen zeitnah hochladen
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || !state.connected || !state.hasKey || state.running) return;
    if (await hasChangesSince(db, state.lastSync)) void syncNow();
  }, 30_000);
}
