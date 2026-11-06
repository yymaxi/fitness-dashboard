import { Link } from 'react-router-dom';
import { db } from '../../data/db';
import { loadDemoData, removeDemoData } from '../../data/demoData';
import { updateSettings } from '../../data/repo';
import { today } from '../../domain/dates';
import type { Settings } from '../../domain/types';
import { useSettings, useToast } from '../../components/hooks';
import { Button, Card, Chip, Field, Input, PageHeader, Toast } from '../../components/ui';

export function SettingsPage() {
  const s = useSettings();
  const [toast, showToast] = useToast();
  const goal = (k: keyof Settings['goals'], v: string) => {
    const n = Number(v.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) void updateSettings({ goals: { ...s.goals, [k]: n } });
  };

  return (
    <>
      <PageHeader title="Einstellungen" />
      <div className="space-y-4">
        <Card title="Darstellung">
          <div className="flex flex-wrap gap-2">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Chip key={t} active={s.theme === t} onClick={() => updateSettings({ theme: t })}>
                {{ system: 'Wie System', light: 'Hell', dark: 'Dunkel' }[t]}
              </Chip>
            ))}
          </div>
        </Card>

        <Card title="Ziele">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Schlaf (h)">
              <Input type="number" step={0.5} value={s.goals.sleepHours} onChange={(e) => goal('sleepHours', e.target.value)} />
            </Field>
            <Field label="Schritte / Tag">
              <Input type="number" step={500} value={s.goals.stepsPerDay} onChange={(e) => goal('stepsPerDay', e.target.value)} />
            </Field>
            <Field label="Kraft / Woche">
              <Input type="number" value={s.goals.strengthPerWeek} onChange={(e) => goal('strengthPerWeek', e.target.value)} />
            </Field>
            <Field label="Mobility / Woche">
              <Input type="number" value={s.goals.mobilityPerWeek} onChange={(e) => goal('mobilityPerWeek', e.target.value)} />
            </Field>
            <Field label="Laufen / Woche">
              <Input type="number" value={s.goals.runsPerWeek} onChange={(e) => goal('runsPerWeek', e.target.value)} />
            </Field>
          </div>
          <p className="mt-3 text-xs text-muted">Ampel-Schwellen, Übungen und Tags werden in Milestone 5 hier einstellbar.</p>
        </Card>

        <Card title="Check-in">
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-sm">Kniebeschwerden mit erfassen</span>
            <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={s.trackKnee} onChange={(e) => updateSettings({ trackKnee: e.target.checked })} />
          </label>
        </Card>

        <Card title="Demo-Daten">
          <p className="mb-3 text-sm text-muted">
            60 Tage ausgedachte Beispielwerte zum Ausprobieren. Deine eigenen Einträge werden dabei nicht überschrieben, und beim Entfernen bleiben sie erhalten.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={async () => showToast(`${await loadDemoData(db, today())} Demo-Einträge geladen`)}
            >
              Demo-Daten laden
            </Button>
            <Button onClick={async () => showToast(`${await removeDemoData(db)} Demo-Einträge entfernt`)}>Demo-Daten entfernen</Button>
          </div>
        </Card>

        <p className="px-1 text-xs text-muted">
          Alle Daten liegen auf diesem Gerät. Import, Backup und Dropbox-Sync findest du unter{' '}
          <Link to="/daten" className="underline">
            Daten &amp; Sync
          </Link>
          .
        </p>
      </div>
      <Toast message={toast} />
    </>
  );
}
