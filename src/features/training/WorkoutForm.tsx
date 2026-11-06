import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../data/db';
import { alive, newId, save, saveMany, softDelete } from '../../data/repo';
import { today } from '../../domain/dates';
import { groupByExercise, lastSetsByExercise, nextKey, prefillSets, WORKOUT_TYPE_LABEL, type SetDraft } from '../../domain/training';
import type { Exercise, MuscleGroup, Workout, WorkoutType } from '../../domain/types';
import { useToast } from '../../components/hooks';
import { Button, Card, Field, Input, PageHeader, Select, SliderField, TextArea, Toast } from '../../components/ui';

interface Draft {
  date: string;
  start: string;
  type: WorkoutType;
  label: string;
  templateId?: string;
  durationMin: number;
  rpe: number;
  distanceKm: string;
  avgHr: string;
  note: string;
}

const MUSCLE_GROUPS: MuscleGroup[] = ['Brust', 'Schultern', 'Trizeps', 'Rücken', 'Bizeps', 'Rumpf', 'Beine', 'Sonstiges'];
const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

export function WorkoutForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const exercises = useLiveQuery(async () => alive(await db.exercises.toArray()).filter((e) => e.archived !== 1), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sets, setSets] = useState<SetDraft[]>([]);
  const [existing, setExisting] = useState<Workout | null>(null);
  const [addExercise, setAddExercise] = useState('');
  const [newEx, setNewEx] = useState<{ name: string; group: MuscleGroup } | null>(null);
  const todoId = params.get('todo') ?? undefined;

  useEffect(() => {
    (async () => {
      if (id) {
        const w = await db.workouts.get(id);
        if (!w || w.deleted === 1) return navigate('/training', { replace: true });
        const ws = alive(await db.workoutSets.where('workoutId').equals(id).toArray()).sort((a, b) => a.order - b.order);
        setExisting(w);
        setDraft({
          date: w.date,
          start: w.start ?? '',
          type: w.type,
          label: w.label ?? '',
          templateId: w.templateId,
          durationMin: w.durationMin,
          rpe: w.rpe ?? 7,
          distanceKm: w.distanceKm?.toString().replace('.', ',') ?? '',
          avgHr: w.avgHr?.toString() ?? '',
          note: w.note ?? '',
        });
        setSets(ws.map((s) => ({ key: nextKey(), exerciseId: s.exerciseId, reps: s.reps, weightKg: s.weightKg })));
        return;
      }
      const tplId = params.get('vorlage');
      const tpl = tplId ? await db.templates.get(tplId) : undefined;
      const type = (tpl?.type ?? (params.get('typ') as WorkoutType | null) ?? 'strength') as WorkoutType;
      const now = new Date();
      setDraft({
        date: today(),
        start: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        type,
        label: type === 'mobility' ? 'Dehnen' : type === 'cardio' ? 'Laufen' : '',
        templateId: tpl?.id,
        durationMin: type === 'strength' ? 60 : type === 'mobility' ? 20 : 30,
        rpe: 7,
        distanceKm: '',
        avgHr: '',
        note: '',
      });
      if (tpl) {
        const history = lastSetsByExercise(alive(await db.workouts.toArray()), alive(await db.workoutSets.toArray()));
        setSets(prefillSets(tpl.exerciseIds, history));
      }
    })();
  }, [id, params, navigate]);

  if (!draft || !exercises) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const exName = new Map(exercises.map((e) => [e.id, e.name]));
  const groups = groupByExercise(sets);
  const updateSet = (key: string, patch: Partial<SetDraft>) => setSets(sets.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  function addSetFor(exerciseId: string) {
    const last = [...sets].reverse().find((s) => s.exerciseId === exerciseId);
    const idx = sets.findLastIndex((s) => s.exerciseId === exerciseId);
    const next = { key: nextKey(), exerciseId, reps: last?.reps ?? 10, weightKg: last?.weightKg ?? 0 };
    setSets(idx === -1 ? [...sets, next] : [...sets.slice(0, idx + 1), next, ...sets.slice(idx + 1)]);
  }

  async function createExercise() {
    if (!newEx?.name.trim()) return;
    const ex: Omit<Exercise, 'updatedAt' | 'deleted'> = {
      id: newId(),
      name: newEx.name.trim(),
      muscleGroup: newEx.group,
      split: ['Brust', 'Schultern', 'Trizeps'].includes(newEx.group) ? 'push' : ['Rücken', 'Bizeps'].includes(newEx.group) ? 'pull' : 'other',
      archived: 0,
    };
    await save(db.exercises, ex);
    setSets([...sets, ...prefillSets([ex.id], new Map())]);
    setNewEx(null);
  }

  async function submit() {
    if (!draft) return;
    const workoutId = existing?.id ?? newId();
    const workout: Omit<Workout, 'updatedAt' | 'deleted'> = {
      ...(existing ?? {}),
      id: workoutId,
      date: draft.date,
      start: draft.start || undefined,
      type: draft.type,
      label: draft.label.trim() || undefined,
      templateId: draft.templateId,
      durationMin: Math.max(1, Math.round(draft.durationMin)),
      rpe: draft.type === 'mobility' ? undefined : draft.rpe,
      distanceKm: draft.type === 'cardio' ? num(draft.distanceKm) : undefined,
      avgHr: draft.type === 'cardio' ? num(draft.avgHr) : undefined,
      note: draft.note.trim() || undefined,
      source: existing?.source ?? 'manual',
    };
    await db.transaction('rw', [db.workouts, db.workoutSets, db.todos], async () => {
      await save(db.workouts, workout);
      // Alte Sätze als gelöscht markieren, aktuelle neu schreiben
      const old = await db.workoutSets.where('workoutId').equals(workoutId).toArray();
      for (const s of old) await softDelete(db.workoutSets, s.id);
      if (draft.type === 'strength') {
        await saveMany(
          db.workoutSets,
          sets
            .filter((s) => s.reps > 0)
            .map((s, order) => ({ id: newId(), workoutId, exerciseId: s.exerciseId, order, reps: s.reps, weightKg: s.weightKg, warmup: 0 as const })),
        );
      }
      if (todoId) {
        const todo = await db.todos.get(todoId);
        if (todo) await save(db.todos, { ...todo, done: 1, doneAt: Date.now(), workoutId });
      }
    });
    showToast('Einheit gespeichert');
    setTimeout(() => navigate('/training'), 500);
  }

  async function remove() {
    if (!existing || !confirm('Diese Einheit wirklich löschen?')) return;
    await softDelete(db.workouts, existing.id);
    for (const s of await db.workoutSets.where('workoutId').equals(existing.id).toArray()) await softDelete(db.workoutSets, s.id);
    navigate('/training');
  }

  return (
    <>
      <PageHeader title={existing ? 'Einheit bearbeiten' : 'Neue Einheit'} subtitle={todoId ? 'Wird nach dem Speichern als erledigt abgehakt.' : undefined} />
      <div className="space-y-4">
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Art">
              <Select value={draft.type} onChange={(e) => set('type', e.target.value as WorkoutType)}>
                {Object.entries(WORKOUT_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bezeichnung">
              <Input value={draft.label} placeholder={draft.templateId ? 'aus Vorlage' : 'z. B. Laufen'} onChange={(e) => set('label', e.target.value)} />
            </Field>
            <Field label="Datum">
              <Input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="Start">
              <Input type="time" value={draft.start} onChange={(e) => set('start', e.target.value)} />
            </Field>
            <Field label="Dauer (min)">
              <Input type="number" inputMode="numeric" min={1} value={draft.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} />
            </Field>
            {draft.type === 'cardio' && (
              <>
                <Field label="Distanz (km)">
                  <Input inputMode="decimal" value={draft.distanceKm} onChange={(e) => set('distanceKm', e.target.value)} />
                </Field>
                <Field label="Ø Puls">
                  <Input inputMode="numeric" value={draft.avgHr} onChange={(e) => set('avgHr', e.target.value)} />
                </Field>
              </>
            )}
          </div>
          {draft.type !== 'mobility' && (
            <div className="mt-4">
              <SliderField label="Intensität (RPE)" value={draft.rpe} onChange={(v) => set('rpe', v)} low="locker" high="maximal" />
            </div>
          )}
        </Card>

        {draft.type === 'strength' && (
          <>
            {groups.map(([exerciseId, exSets]) => (
              <Card
                key={exerciseId}
                title={exName.get(exerciseId) ?? 'Übung'}
                action={
                  <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => setSets(sets.filter((s) => s.exerciseId !== exerciseId))}>
                    Entfernen
                  </Button>
                }
              >
                <div className="space-y-2">
                  <div className="grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 text-xs text-muted">
                    <span>Satz</span>
                    <span>Wdh.</span>
                    <span>kg</span>
                    <span />
                  </div>
                  {exSets.map((s, i) => (
                    <div key={s.key} className="grid grid-cols-[2rem_1fr_1fr_2.5rem] items-center gap-2">
                      <span className="text-sm text-muted tabular-nums">{i + 1}</span>
                      <Input type="number" inputMode="numeric" min={0} aria-label="Wiederholungen" value={s.reps} onChange={(e) => updateSet(s.key, { reps: Number(e.target.value) })} />
                      <Input type="number" inputMode="decimal" min={0} step={0.5} aria-label="Gewicht in kg" value={s.weightKg} onChange={(e) => updateSet(s.key, { weightKg: Number(e.target.value) })} />
                      <Button variant="ghost" className="px-0" aria-label="Satz löschen" onClick={() => setSets(sets.filter((x) => x.key !== s.key))}>
                        ✕
                      </Button>
                    </div>
                  ))}
                  <Button variant="ghost" className="-ml-2" onClick={() => addSetFor(exerciseId)}>
                    + Satz
                  </Button>
                </div>
              </Card>
            ))}

            <Card title="Übung hinzufügen">
              <div className="flex gap-2">
                <Select value={addExercise} onChange={(e) => setAddExercise(e.target.value)}>
                  <option value="">Übung wählen …</option>
                  {exercises.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.muscleGroup})
                    </option>
                  ))}
                </Select>
                <Button
                  disabled={!addExercise}
                  onClick={() => {
                    setSets([...sets, ...prefillSets([addExercise], new Map())]);
                    setAddExercise('');
                  }}
                >
                  Hinzufügen
                </Button>
              </div>
              {newEx ? (
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <Input placeholder="Name der Übung" value={newEx.name} onChange={(e) => setNewEx({ ...newEx, name: e.target.value })} />
                  <Select className="w-36" value={newEx.group} onChange={(e) => setNewEx({ ...newEx, group: e.target.value as MuscleGroup })}>
                    {MUSCLE_GROUPS.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </Select>
                  <Button variant="primary" className="col-span-2" onClick={createExercise}>
                    Übung anlegen
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" className="mt-2 -ml-2" onClick={() => setNewEx({ name: '', group: 'Brust' })}>
                  + Neue Übung anlegen
                </Button>
              )}
            </Card>
          </>
        )}

        <Card>
          <Field label="Notiz">
            <TextArea value={draft.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </Card>

        <div className="flex gap-2">
          {existing && (
            <Button variant="danger" onClick={remove}>
              Löschen
            </Button>
          )}
          <Button variant="primary" className="flex-1 text-base" onClick={submit}>
            Speichern
          </Button>
        </div>
      </div>
      <Toast message={toast} />
    </>
  );
}
