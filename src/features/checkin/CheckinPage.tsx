import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../data/db';
import { alive, dayId, save } from '../../data/repo';
import { checkinDefaults, manualSleepMinutes, type CheckinDraft } from '../../domain/checkin';
import { formatDuration, today } from '../../domain/dates';
import type { Checkin, SleepNight } from '../../domain/types';
import { useSettings, useToast } from '../../components/hooks';
import { Button, Card, Chip, Field, Input, PageHeader, SliderField, TextArea, Toast } from '../../components/ui';

export function CheckinPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const [date, setDate] = useState(today());
  const [draft, setDraft] = useState<CheckinDraft | null>(null);
  const [importedNight, setImportedNight] = useState<SleepNight | null>(null);
  const [isEdit, setIsEdit] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await db.checkins.get(dayId.checkin(date));
      const previous = alive(await db.checkins.where('date').below(date).reverse().sortBy('date')).at(0);
      const nightToday = await db.sleepNights.get(dayId.sleep(date));
      const lastNight = alive(await db.sleepNights.where('date').below(date).sortBy('date')).at(-1);
      if (cancelled) return;
      const live = existing && existing.deleted !== 1 ? existing : undefined;
      const night = nightToday && nightToday.deleted !== 1 ? nightToday : undefined;
      setIsEdit(!!live);
      setImportedNight(night && night.source === 'apple-health' ? night : null);
      const d = checkinDefaults(date, { existing: live, previous, nightToday: night, lastNight, trackKnee: settings.trackKnee });
      setDraft(d);
      setShowNote(!!d.note);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, settings.trackKnee]);

  if (!draft) return null;
  const set = <K extends keyof CheckinDraft>(k: K, v: CheckinDraft[K]) => setDraft({ ...draft, [k]: v });
  const sleepMin = importedNight?.asleepMin ?? manualSleepMinutes(draft.bedtime, draft.wakeTime);
  const goalMin = settings.goals.sleepHours * 60;

  async function submit() {
    if (!draft) return;
    const record: Omit<Checkin, 'updatedAt' | 'deleted'> = {
      id: dayId.checkin(draft.date),
      date: draft.date,
      sleepQuality: draft.sleepQuality,
      recovery: draft.recovery,
      soreness: draft.soreness,
      mood: draft.mood,
      energy: draft.energy,
      stress: draft.stress,
      kneePain: draft.kneePain,
      tags: draft.tags,
      note: draft.note.trim() || undefined,
    };
    await db.transaction('rw', db.checkins, db.sleepNights, async () => {
      await save(db.checkins, record);
      // Importierte Nächte (mit Phasen) nicht durch manuelle Zeiten überschreiben
      if (!importedNight) {
        await save(db.sleepNights, {
          id: dayId.sleep(draft.date),
          date: draft.date,
          bedtime: draft.bedtime,
          wakeTime: draft.wakeTime,
          asleepMin: manualSleepMinutes(draft.bedtime, draft.wakeTime),
          source: 'manual',
        });
      }
    });
    showToast('Check-in gespeichert');
    setTimeout(() => navigate('/'), 600);
  }

  const toggleTag = (t: string) => set('tags', draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t]);

  return (
    <>
      <PageHeader
        title="Check-in"
        subtitle={isEdit ? 'Du bearbeitest den Check-in dieses Tages.' : 'Vorbelegt mit deinen letzten Werten – nur anpassen, was anders ist.'}
      />
      <div className="space-y-4">
        <Card title="Schlaf letzte Nacht">
          <div className="space-y-4">
            {importedNight ? (
              <p className="text-sm">
                <span className="font-medium">
                  {importedNight.bedtime}–{importedNight.wakeTime}
                </span>{' '}
                · {formatDuration(importedNight.asleepMin)} Schlaf <span className="text-muted">(aus Apple Health)</span>
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Eingeschlafen">
                  <Input type="time" value={draft.bedtime} onChange={(e) => set('bedtime', e.target.value)} />
                </Field>
                <Field label="Aufgewacht">
                  <Input type="time" value={draft.wakeTime} onChange={(e) => set('wakeTime', e.target.value)} />
                </Field>
              </div>
            )}
            <p className="text-sm text-muted">
              {formatDuration(sleepMin)} · Ziel {settings.goals.sleepHours} h ({sleepMin >= goalMin ? 'erreicht' : `${formatDuration(goalMin - sleepMin)} darunter`})
            </p>
            <SliderField label="Schlafqualität" value={draft.sleepQuality} onChange={(v) => set('sleepQuality', v)} low="schlecht" high="sehr gut" />
          </div>
        </Card>

        <Card title="Körper">
          <div className="space-y-4">
            <SliderField label="Erholung" value={draft.recovery} onChange={(v) => set('recovery', v)} low="erschöpft" high="topfit" />
            <SliderField label="Muskelkater" value={draft.soreness} onChange={(v) => set('soreness', v)} low="keiner" high="stark" />
            {draft.kneePain !== undefined && (
              <SliderField label="Kniebeschwerden" min={0} value={draft.kneePain} onChange={(v) => set('kneePain', v)} low="keine" high="stark" />
            )}
          </div>
        </Card>

        <Card title="Kopf">
          <div className="space-y-4">
            <SliderField label="Stimmung" value={draft.mood} onChange={(v) => set('mood', v)} low="mies" high="super" />
            <SliderField label="Energie" value={draft.energy} onChange={(v) => set('energy', v)} low="leer" high="voll" />
            <SliderField label="Stress" value={draft.stress} onChange={(v) => set('stress', v)} low="entspannt" high="sehr hoch" />
          </div>
        </Card>

        <Card title="Gestern Abend (optional)">
          <div className="flex flex-wrap gap-2">
            {settings.tags.map((t) => (
              <Chip key={t} active={draft.tags.includes(t)} onClick={() => toggleTag(t)}>
                {t}
              </Chip>
            ))}
          </div>
          {showNote ? (
            <div className="mt-4">
              <TextArea placeholder="Notiz zum Tag" value={draft.note} onChange={(e) => set('note', e.target.value)} />
            </div>
          ) : (
            <Button variant="ghost" className="mt-3 -ml-2" onClick={() => setShowNote(true)}>
              + Notiz hinzufügen
            </Button>
          )}
        </Card>

        <details className="text-sm text-muted">
          <summary className="cursor-pointer py-2">Anderen Tag nachtragen</summary>
          <Input type="date" max={today()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="mt-2" />
        </details>

        <div className="sticky bottom-20 md:bottom-4">
          <Button variant="primary" className="w-full text-base shadow-lg" onClick={submit}>
            {isEdit ? 'Änderungen speichern' : 'Check-in speichern'}
          </Button>
        </div>
      </div>
      <Toast message={toast} />
    </>
  );
}
