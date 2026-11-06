/**
 * Ende-zu-Ende-Verschlüsselung der Sync-Datei: PBKDF2 (SHA-256) leitet aus dem
 * Passwort einen AES-GCM-256-Schlüssel ab; die Daten werden vorher gzip-komprimiert.
 * Dropbox sieht nur den verschlüsselten Umschlag.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';

export const ENVELOPE_FORMAT = 'fitness-dashboard-sync';
export const DEFAULT_ITERATIONS = 600_000;

export interface Envelope {
  format: typeof ENVELOPE_FORMAT;
  version: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  iv: string;
  data: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Das Passwort passt nicht zu den Sync-Daten.');
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations = DEFAULT_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface KeyInfo {
  key: CryptoKey;
  salt: string;
  iterations: number;
}

export async function encryptJson(value: unknown, k: KeyInfo): Promise<string> {
  const iv = randomBytes(12);
  const plain = gzipSync(strToU8(JSON.stringify(value)));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, plain));
  const env: Envelope = {
    format: ENVELOPE_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations: k.iterations, salt: k.salt },
    iv: toBase64(iv),
    data: toBase64(cipher),
  };
  return JSON.stringify(env);
}

export function parseEnvelope(text: string): Envelope {
  const env = JSON.parse(text) as Partial<Envelope>;
  if (env.format !== ENVELOPE_FORMAT || env.version !== 1 || !env.kdf?.salt || !env.iv || !env.data) {
    throw new Error('Die Sync-Datei hat ein unbekanntes Format.');
  }
  return env as Envelope;
}

export async function decryptJson<T>(env: Envelope, key: CryptoKey): Promise<T> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv) }, key, fromBase64(env.data));
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(strFromU8(gunzipSync(new Uint8Array(plain)))) as T;
}
