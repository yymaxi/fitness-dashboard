import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../data/db';
import { alive } from '../../data/repo';
import { formatDate, formatDuration } from '../../domain/dates';
import { WORKOUT_TYPE_LABEL } from '../../domain/training';
import { ButtonLink, EmptyState, PageHeader } from '../../components/ui';

export function TrainingPage() {
  const workouts = useLiveQuery(async () => alive(await db.workouts.orderBy('date').reverse().limit(60).toArray()), []);
  const templates = useLiveQuery(async () => alive(await db.templates.toArray()), []);
  const setCounts = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    for (const s of alive(await db.workoutSets.toArray())) counts.set(s.workoutId, (counts.get(s.workoutId) ?? 0) + 1);
    return counts;
  }, []);
  const tplName = new Map((templates ?? []).map((t) => [t.id, t.name]));

  return (
    <>
      <PageHeader title="Training" subtitle="Einheiten erfassen und ansehen. Diagramme und PRs folgen in Milestone 3." />
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(templates ?? []).map((t) => (
          <ButtonLink key={t.id} to={`/training/neu?vorlage=${t.id}`} variant="primary">
            {t.name}
          </ButtonLink>
        ))}
        <ButtonLink to="/training/neu?typ=mobility">Mobility</ButtonLink>
        <ButtonLink to="/training/neu?typ=cardio">Ausdauer</ButtonLink>
      </div>

      {workouts && workouts.length === 0 && (
        <EmptyState
          title="Noch keine Einheiten"
          text="Starte oben mit einer Vorlage. Später kommen Einheiten auch automatisch aus dem Apple-Health-Import."
        />
      )}

      <ul className="space-y-2">
        {(workouts ?? []).map((w) => (
          <li key={w.id}>
            <Link to={`/training/${w.id}`} className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 hover:border-accent">
              <div>
                <p className="font-medium">
                  {(w.templateId && tplName.get(w.templateId)) || w.label || WORKOUT_TYPE_LABEL[w.type]}
                  <span className="ml-2 text-xs font-normal text-muted">{WORKOUT_TYPE_LABEL[w.type]}</span>
                </p>
                <p className="text-sm text-muted">
                  {formatDate(w.date)} · {formatDuration(w.durationMin)}
                  {w.distanceKm ? ` · ${w.distanceKm.toLocaleString('de-DE')} km` : ''}
                  {setCounts?.get(w.id) ? ` · ${setCounts.get(w.id)} Sätze` : ''}
                </p>
              </div>
              {w.rpe && <span className="text-sm text-muted">RPE {w.rpe}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
