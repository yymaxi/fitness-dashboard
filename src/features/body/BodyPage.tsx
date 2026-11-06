import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { alive, newId, save, softDelete } from '../../data/repo';
import { formatDate, today } from '../../domain/dates';
import { Button, Card, EmptyState, Field, Input, PageHeader } from '../../components/ui';

const parse = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));
const fmt = (n?: number) => (n === undefined ? '–' : n.toLocaleString('de-DE', { maximumFractionDigits: 1 }));

export function BodyPage() {
  const rows = useLiveQuery(async () => alive(await db.bodyMetrics.orderBy('date').reverse().toArray()), []);
  const [date, setDate] = useState(today());
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');

  async function add() {
    const weightKg = parse(weight);
    const waistCm = parse(waist);
    if (weightKg === undefined && waistCm === undefined) return;
    await save(db.bodyMetrics, { id: newId(), date, weightKg, waistCm, source: 'manual' });
    setWeight('');
    setWaist('');
  }

  return (
    <>
      <PageHeader title="Körper" subtitle="Gewicht und Umfänge. Messungen deiner Zepp-Waage kommen später per Import." />
      <Card className="mb-5">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Datum">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Gewicht (kg)">
            <Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
          <Field label="Bauch (cm)">
            <Input inputMode="decimal" value={waist} onChange={(e) => setWaist(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" className="mt-3 w-full" onClick={add}>
          Speichern
        </Button>
      </Card>
      {rows && rows.length === 0 ? (
        <EmptyState title="Noch keine Messungen" text="Trag dein Gewicht ein oder lade in den Einstellungen die Demo-Daten." />
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {(rows ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted">{formatDate(r.date)}</span>
              <span className="tabular-nums">
                {fmt(r.weightKg)} kg{r.waistCm !== undefined && ` · ${fmt(r.waistCm)} cm`}
              </span>
              <Button variant="ghost" className="min-h-9 px-2" aria-label="Löschen" onClick={() => softDelete(db.bodyMetrics, r.id)}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
