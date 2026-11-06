/**
 * Dropbox-Anbindung per OAuth 2 mit PKCE (kein Server, kein App-Secret).
 * Die App hat nur Zugriff auf ihren eigenen App-Ordner (Apps/<App-Name>).
 *
 * Im Dropbox App Console müssen die Redirect-URIs eingetragen sein, z. B.
 *   https://<user>.github.io/fitness-dashboard/
 *   http://localhost:5173/
 */
import { ConflictError } from './engine';

export const DROPBOX_APP_KEY = 'f7rve0x5l74te9d';
const AUTH_KEY = 'fd.dropbox.auth';
const PKCE_KEY = 'fd.dropbox.pkce';

interface StoredAuth {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  accountId?: string;
}

export class DropboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly summary = '',
  ) {
    super(message);
  }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function redirectUri(): string {
  return location.origin + location.pathname;
}

function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

function storeAuth(a: StoredAuth | null) {
  if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
  else localStorage.removeItem(AUTH_KEY);
}

export function isConnected(): boolean {
  return loadAuth() !== null;
}

/** Leitet zu Dropbox weiter. Danach kommt der Browser mit ?code=… zurück. */
export async function startDropboxAuth(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    token_access_type: 'offline',
    state,
  });
  location.assign(`https://www.dropbox.com/oauth2/authorize?${params}`);
}

/**
 * Beim App-Start aufrufen: Tauscht einen zurückgegebenen Code gegen Tokens.
 * Gibt `true` zurück, wenn gerade eine Verbindung hergestellt wurde.
 */
export async function completeDropboxAuth(): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;

  const clean = () => history.replaceState(null, '', `${location.pathname}#/daten`);
  const pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; state: string } | null;
  sessionStorage.removeItem(PKCE_KEY);
  if (error || !pkce || pkce.state !== state) {
    clean();
    if (error) throw new Error(`Dropbox: ${url.searchParams.get('error_description') ?? error}`);
    return false;
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      client_id: DROPBOX_APP_KEY,
      code_verifier: pkce.verifier,
      redirect_uri: redirectUri(),
    }),
  });
  clean();
  if (!res.ok) throw new DropboxError(`Dropbox-Anmeldung fehlgeschlagen (${res.status})`, res.status);
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; account_id?: string };
  storeAuth({ refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000, accountId: t.account_id });
  return true;
}

async function accessToken(): Promise<string> {
  const auth = loadAuth();
  if (!auth) throw new DropboxError('Nicht mit Dropbox verbunden.', 401);
  if (auth.expiresAt > Date.now()) return auth.accessToken;
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: DROPBOX_APP_KEY }),
  });
  if (res.status === 400 || res.status === 401) {
    storeAuth(null); // Zugriff wurde in Dropbox widerrufen
    throw new DropboxError('Die Dropbox-Verbindung ist abgelaufen. Bitte neu verbinden.', 401);
  }
  if (!res.ok) throw new DropboxError(`Dropbox nicht erreichbar (${res.status})`, res.status);
  const t = (await res.json()) as { access_token: string; expires_in: number };
  storeAuth({ ...auth, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 });
  return t.access_token;
}

/** Dropbox-API-Arg muss ASCII sein; Nicht-ASCII als \uXXXX. */
const apiArg = (v: unknown) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

async function errorSummary(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error_summary?: string };
    return body.error_summary ?? '';
  } catch {
    return '';
  }
}

export interface RemoteFile {
  text: string;
  rev: string;
}

/** Lädt eine Datei aus dem App-Ordner; `null`, wenn es sie noch nicht gibt. */
export async function downloadFile(path: string): Promise<RemoteFile | null> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Dropbox-API-Arg': apiArg({ path }) },
  });
  if (res.status === 409) {
    const summary = await errorSummary(res);
    if (summary.includes('not_found')) return null;
    throw new DropboxError(`Dropbox: ${summary}`, 409, summary);
  }
  if (!res.ok) throw new DropboxError(`Download fehlgeschlagen (${res.status})`, res.status);
  const meta = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}') as { rev?: string };
  const text = await res.text();
  return { text, rev: meta.rev ?? (await getRev(path)) };
}

async function getRev(path: string): Promise<string> {
  const res = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new DropboxError(`Dropbox-Metadaten nicht lesbar (${res.status})`, res.status);
  return ((await res.json()) as { rev: string }).rev;
}

/**
 * Lädt hoch. Mit `rev` nur, wenn die Datei seitdem unverändert ist – sonst
 * ConflictError (ein anderes Gerät war schneller, dann neu zusammenführen).
 */
export async function uploadFile(path: string, text: string, rev: string | null): Promise<string> {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({ path, mode: rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' }, autorename: false, mute: true }),
    },
    body: text,
  });
  if (res.status === 409) {
    const summary = await errorSummary(res);
    if (summary.includes('conflict')) throw new ConflictError(summary);
    throw new DropboxError(`Dropbox: ${summary}`, 409, summary);
  }
  if (!res.ok) throw new DropboxError(`Upload fehlgeschlagen (${res.status})`, res.status);
  return ((await res.json()) as { rev: string }).rev;
}

export async function disconnectDropbox(): Promise<void> {
  const auth = loadAuth();
  storeAuth(null);
  if (!auth) return;
  try {
    await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}` } });
  } catch {
    // Offline – Token verfällt ohnehin
  }
}
