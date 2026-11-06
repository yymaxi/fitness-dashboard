import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FitnessDB } from '../../data/db';
import { dayId, save, softDelete } from '../../data/repo';
import { loadDemoData } from '../../data/demoData';
import { decryptJson, deriveKey, encryptJson, fromBase64, parseEnvelope, toBase64, WrongPasswordError, type KeyInfo } from '../crypto';
import { ConflictError, NeedsPasswordError, setupPassword, SYNC_PATH, syncOnce, type DeviceStore, type Remote } from '../engine';

const ITER = 1000; // in Tests schnell; die App nutzt 600 000

class MemoryRemote implements Remote {
  file: { text: string; rev: string } | null = null;
  uploads = 0;
  /** Simuliert ein anderes Gerät, das zwischen Download und Upload schreibt. */
  beforeUpload: (() => void) | null = null;
  async download(path: string) {
    expect(path).toBe(SYNC_PATH);
    return this.file ? { ...this.file } : null;
  }
  async upload(_path: string, text: string, rev: string | null) {
    const hook = this.beforeUpload;
    this.beforeUpload = null;
    hook?.();
    if ((this.file?.rev ?? null) !== rev) throw new ConflictError('path/conflict');
    this.uploads++;
    this.file = { text, rev: `r${this.uploads}` };
    return this.file.rev;
  }
}

function memoryStore(): DeviceStore {
  let key: KeyInfo | null = null;
  let last = 0;
  return {
    getKey: async () => key,
    setKey: async (k) => void (key = k),
    getLastSync: async () => last,
    setLastSync: async (ms) => void (last = ms),
  };
}

const checkin = (date: string, recovery: number) => ({
  id: dayId.checkin(date), date, recovery, soreness: 3, mood: 7, energy: 6, stress: 4, sleepQuality: 7, tags: [],
});

let dbs: FitnessDB[] = [];
let n = 0;
async function device() {
  const db = new FitnessDB(`sync-${n++}`);
  await db.open();
  dbs.push(db);
  return { db, store: memoryStore() };
}
beforeEach(() => {
  dbs = [];
});
afterEach(async () => {
  for (const d of dbs) await d.delete();
});

describe('Verschlüsselung', () => {
  it('ver- und entschlüsselt; falsches Passwort wird erkannt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k: KeyInfo = { key: await deriveKey('richtig-gut', salt, ITER), salt: toBase64(salt), iterations: ITER };
    const text = await encryptJson({ hallo: 'Welt', n: [1, 2, 3] }, k);
    expect(text).not.toContain('Welt');
    const env = parseEnvelope(text);
    expect(await decryptJson(env, k.key)).toEqual({ hallo: 'Welt', n: [1, 2, 3] });
    const wrong = await deriveKey('falsch', fromBase64(env.kdf.salt), ITER);
    await expect(decryptJson(env, wrong)).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe('Sync zwischen zwei Geräten', () => {
  it('überträgt Änderungen in beide Richtungen, neuere gewinnt, Demo-Daten bleiben lokal', async () => {
    const remote = new MemoryRemote();
    const phone = await device();
    const pc = await device();

    expect(await setupPassword(remote, phone.store, 'geheim123', ITER)).toBe('created');
    await save(phone.db.checkins, checkin('2026-11-05', 6), 1000);
    await loadDemoData(phone.db, '2026-11-06');
    expect(await syncOnce(phone.db, remote, phone.store)).toMatchObject({ pushed: true });

    // PC tritt bei: falsches Passwort scheitert, richtiges klappt
    await expect(setupPassword(remote, pc.store, 'falsch', ITER)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await setupPassword(remote, pc.store, 'geheim123', ITER)).toBe('joined');
    await syncOnce(pc.db, remote, pc.store);
    expect((await pc.db.checkins.get('ci-2026-11-05'))?.recovery).toBe(6);
    expect(await pc.db.checkins.count()).toBe(1); // keine Demo-Check-ins vom Handy

    // Beide ändern: PC später → PC gewinnt; Löschung auf dem Handy kommt an
    await save(phone.db.checkins, checkin('2026-11-05', 4), 2000);
    await save(pc.db.checkins, checkin('2026-11-05', 9), 3000);
    await save(phone.db.todos, { id: 'todo-x', title: 'Einkaufen', priority: 'mittel', category: 'Alltag', done: 0 }, 2000);
    await syncOnce(phone.db, remote, phone.store);
    await softDelete(phone.db.todos, 'todo-x', 2500);
    await syncOnce(phone.db, remote, phone.store);
    await syncOnce(pc.db, remote, pc.store);
    await syncOnce(phone.db, remote, phone.store);

    for (const d of [phone, pc]) {
      expect((await d.db.checkins.get('ci-2026-11-05'))?.recovery).toBe(9);
      expect((await d.db.todos.get('todo-x'))?.deleted).toBe(1);
    }
    // Demo-Check-ins des Handys sind weiterhin nur dort
    expect(await phone.db.checkins.count()).toBeGreaterThan(50);
    expect(await pc.db.checkins.count()).toBe(1);
  });

  it('lädt nichts hoch, wenn sich nichts geändert hat', async () => {
    const remote = new MemoryRemote();
    const a = await device();
    await setupPassword(remote, a.store, 'geheim123', ITER);
    await syncOnce(a.db, remote, a.store);
    const uploads = remote.uploads;
    expect(await syncOnce(a.db, remote, a.store)).toEqual({ pulled: 0, pushed: false });
    expect(remote.uploads).toBe(uploads);
  });

  it('führt bei gleichzeitigem Upload eines anderen Geräts neu zusammen', async () => {
    const remote = new MemoryRemote();
    const a = await device();
    const b = await device();
    await setupPassword(remote, a.store, 'geheim123', ITER);
    await syncOnce(a.db, remote, a.store);
    await setupPassword(remote, b.store, 'geheim123', ITER);

    await save(a.db.checkins, checkin('2026-11-01', 5), 1000);
    await save(b.db.checkins, checkin('2026-11-02', 8), 1000);
    await syncOnce(b.db, remote, b.store);
    const revBefore = remote.file!.rev;
    let raced = false;
    // Ein drittes Gerät lädt zwischen Download und Upload von A hoch
    remote.beforeUpload = () => {
      raced = true;
      remote.file = { ...remote.file!, rev: `${revBefore}-fremd` };
    };
    await syncOnce(a.db, remote, a.store);
    expect(raced).toBe(true);
    await syncOnce(b.db, remote, b.store);
    for (const d of [a, b]) expect((await d.db.checkins.toArray()).map((c) => c.date).sort()).toEqual(['2026-11-01', '2026-11-02']);
  });

  it('verlangt ohne Schlüssel ein Passwort', async () => {
    const a = await device();
    await expect(syncOnce(a.db, new MemoryRemote(), a.store)).rejects.toBeInstanceOf(NeedsPasswordError);
  });
});
