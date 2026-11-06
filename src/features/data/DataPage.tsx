import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ImportRule } from '../../data/db';
import { alive, save, softDelete } from '../../data/repo';
import { toISODate } from '../../domain/dates';
import type { WorkoutType } from '../../domain/types';
import { applyHealthImport, type ImportSummary } from '../../import/applyImport';
import { runHealthImportWorker } from '../../import/workerProtocol';
import { createBackup, parseBackup, restoreBackup, type RestoreMode } from '../../sync/snapshot';
import { disconnect, setSyncPassword, syncNow, useSyncState } from '../../sync/controller';
import { startDropboxAuth } from '../../sync/dropbox';
import { useToast } from '../../components/hooks';
import { Button, Card, Field, Input, PageHeader, Select, Toast } from '../../components/ui';

const TYPE_LABEL: Record<WorkoutType, string> = { strength: 'Kraft', cardio: 'Ausdauer', mobility: 'Mobility', other: 'Sonstiges' };

export function DataPage() {
  const [toast, showToast] = useToast();
  return (
    <>
      <PageHeader title="Daten & Sync" subtitle="Apple Health importieren, Backups und Abgleich zwischen Geräten." />
      <div className="space-y-4">
        <HealthImportCard />
        <ImportRulesCard />
        <SyncCard />
        <BackupCard showToast={showToast} />
      </div>
      <Toast message={toast} />
    </>
  );
}

// ---------------------------------------------------------------- Apple Health

function HealthImportCard() {
  const [progress, setProgress] = useState<number | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sleepSource, setSleepSource] = useState('Zepp');
  const input = useRef<HTMLInputElement>(null);

  async function run(file: File) {
    setError(null);
    setSummary(null);
    setProgress(0);
    try {
      const rules = alive(await db.importRules.toArray());
      const result = await runHealthImportWorker({ file, rules, sleepSource: sleepSource.trim() || 'Zepp' }, setProgress);
      setSummary(await applyHealthImport(db, result));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }

  const line = (label: string, c: ImportSummary['workouts']) =>
    `${label}: ${c.added} neu, ${c.updated} aktualisiert, ${c.unchanged} unverändert${c.skipped ? `, ${c.skipped} gelöscht (übersprungen)` : ''}`;

  return (
    <Card title="Apple Health importieren">
      <p className="mb-3 text-sm text-muted">
        In der Health-App: Profilbild → „Alle Gesundheitsdaten exportieren“. Die <code>export.zip</code> hier auswählen – sie wird direkt im
        Browser gelesen und nirgendwohin hochgeladen. Mehrfaches Importieren erzeugt keine Duplikate.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Schlaf übernehmen von" hint="Teil des Quellnamens in Apple Health, z. B. „Zepp“.">
          <Input value={sleepSource} onChange={(e) => setSleepSource(e.target.value)} />
        </Field>
        <Button variant="primary" disabled={progress !== null} onClick={() => input.current?.click()}>
          Export auswählen
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".zip,.xml,application/zip,text/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(f);
        }}
      />
      {progress !== null && (
        <div className="mt-4" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">Lese Export … {Math.round(progress * 100)} %</p>
        </div>
      )}
      {summary && (
        <ul className="mt-4 space-y-1 text-sm">
          <li>{line('Nächte', summary.sleepNights)}</li>
          <li>{line('Tageswerte', summary.dailyVitals)}</li>
          <li>{line('Workouts', summary.workouts)}</li>
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <p className="mt-3 text-xs text-muted">
        Schritte: pro Tag zählt die Quelle mit den meisten Schritten (iPhone und Uhr zählen dieselben Schritte). HRV: Median der Messungen
        während des Schlafs. Importierte Nächte ersetzen die Schätzung aus dem Check-in.
      </p>
    </Card>
  );
}

function ImportRulesCard() {
  const rules = useLiveQuery(async () => alive(await db.importRules.toArray()), []) ?? [];
  const [draft, setDraft] = useState({ source: 'Zepp', match: 'Other', workoutType: 'mobility' as WorkoutType, label: '' });

  async function add() {
    if (!draft.source.trim() || !draft.match.trim()) return;
    const match = draft.match.trim().startsWith('HKWorkoutActivityType') ? draft.match.trim() : `HKWorkoutActivityType${draft.match.trim()}`;
    await save<ImportRule>(db.importRules, {
      id: crypto.randomUUID(),
      source: draft.source.trim(),
      match,
      workoutType: draft.workoutType,
      label: draft.label.trim() || undefined,
    });
    setDraft({ ...draft, label: '' });
  }

  return (
    <Card title="Zuordnung beim Import">
      <p className="mb-3 text-sm text-muted">Workouts einer Quelle mit einer bestimmten Aktivität bekommen eine andere Trainingsart.</p>
      <ul className="mb-4 divide-y divide-line">
        {rules.map((r) => (
          <li key={r.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span>
              {r.source} · „{r.match.replace('HKWorkoutActivityType', '')}“ → {TYPE_LABEL[r.workoutType]}
              {r.label ? ` (${r.label})` : ''}
            </span>
            <Button variant="ghost" onClick={() => softDelete(db.importRules, r.id)} aria-label="Regel löschen">
              Entfernen
            </Button>
          </li>
        ))}
        {rules.length === 0 && <li className="py-2 text-sm text-muted">Keine Regeln.</li>}
      </ul>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Quelle">
          <Input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
        </Field>
        <Field label="Aktivität">
          <Input value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value })} placeholder="Other" />
        </Field>
        <Field label="Art">
          <Select value={draft.workoutType} onChange={(e) => setDraft({ ...draft, workoutType: e.target.value as WorkoutType })}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bezeichnung">
          <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="optional" />
        </Field>
      </div>
      <Button className="mt-3" onClick={add}>
        Regel hinzufügen
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------- Dropbox

function SyncCard() {
  const s = useSyncState();
  const [password, setPassword] = useState('');
  const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Card title="Dropbox-Sync">
      <p className="mb-3 text-sm text-muted">
        Gleicht Handy und PC über deine eigene Dropbox ab (nur der App-Ordner). Die Daten werden vorher mit deinem Passwort verschlüsselt –
        Dropbox sieht nur unlesbare Daten. Demo-Daten werden nicht synchronisiert.
      </p>
      {!s.connected ? (
        <Button variant="primary" onClick={() => void startDropboxAuth()}>
          Mit Dropbox verbinden
        </Button>
      ) : !s.hasKey ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length >= 8) void setSyncPassword(password).then(() => setPassword(''));
          }}
        >
          <Field label="Sync-Passwort" hint="Auf allen Geräten dasselbe, mindestens 8 Zeichen. Ohne Passwort sind die Sync-Daten nicht wiederherstellbar.">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={password.length < 8 || s.running}>
              {s.running ? 'Prüfe …' : 'Passwort festlegen'}
            </Button>
            <Button variant="ghost" onClick={() => void disconnect()}>
              Trennen
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            {s.running ? 'Synchronisiere …' : s.lastSync ? `Zuletzt synchronisiert: ${fmt.format(s.lastSync)}` : 'Noch nicht synchronisiert.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={s.running} onClick={() => void syncNow()}>
              Jetzt synchronisieren
            </Button>
            <Button variant="ghost" onClick={() => void disconnect()}>
              Trennen
            </Button>
          </div>
        </div>
      )}
      {s.info && !s.error && <p className="mt-3 text-sm text-muted">{s.info}</p>}
      {s.error && <p className="mt-3 text-sm text-bad">{s.error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- Backup

function BackupCard({ showToast }: { showToast: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [error, setError] = useState<string | null>(null);

  async function download() {
    const backup = await createBackup(db);
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitness-backup-${toISODate(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function restore(file: File) {
    setError(null);
    try {
      const backup = parseBackup(await file.text());
      if (mode === 'replace' && !confirm('Alle Daten auf diesem Gerät werden durch das Backup ersetzt. Fortfahren?')) return;
      const n = await restoreBackup(db, backup, mode);
      showToast(`${n} Einträge wiederhergestellt`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Card title="Backup">
      <p className="mb-3 text-sm text-muted">
        Alle Daten als JSON-Datei sichern und später auf diesem oder einem anderen Gerät wiederherstellen. „Zusammenführen“ behält pro Eintrag
        die neuere Änderung, „Alles ersetzen“ überschreibt die Daten dieses Geräts.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="primary" onClick={() => void download()}>
          Backup herunterladen
        </Button>
        <Select className="w-auto" value={mode} onChange={(e) => setMode(e.target.value as RestoreMode)} aria-label="Art der Wiederherstellung">
          <option value="merge">Zusammenführen</option>
          <option value="replace">Alles ersetzen</option>
        </Select>
        <Button onClick={() => input.current?.click()}>Backup wiederherstellen</Button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void restore(f);
        }}
      />
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
    </Card>
  );
}
