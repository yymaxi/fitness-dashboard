import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../data/db';
import { alive, dayId } from '../../data/repo';
import { addDays, formatDate, formatDuration, startOfWeek, today } from '../../domain/dates';
import { weeklyGoals, type GoalProgress } from '../../domain/goals';
import { computeReadiness, type Level, type Readiness, type ReadinessResult } from '../../domain/readiness';
import { sleepScore } from '../../domain/sleepScore';
import { isOverdue, sortOpenTodos } from '../../domain/todos';
import type { Checkin, SleepNight, Todo } from '../../domain/types';
import { useSettings } from '../../components/hooks';
import { ButtonLink, Card, cx, EmptyState } from '../../components/ui';

const STATUS_STYLE: Record<Readiness, { ring: string; text: string; icon: string; label: string }> = {
  green: { ring: 'bg-good', text: 'text-good', icon: '✓', label: 'Grün' },
  yellow: { ring: 'bg-warn', text: 'text-warn', icon: '!', label: 'Gelb' },
  red: { ring: 'bg-bad', text: 'text-bad', icon: '✕', label: 'Rot' },
  unknown: { ring: 'bg-surface-2', text: 'text-muted', icon: '?', label: 'Offen' },
};
const LEVEL_STYLE: Record<Level, { cls: string; icon: string; label: string }> = {
  good: { cls: 'text-good', icon: '●', label: 'gut' },
  warn: { cls: 'text-warn', icon: '▲', label: 'mittel' },
  bad: { cls: 'text-bad', icon: '■', label: 'schlecht' },
};

export function DashboardPage() {
  const settings = useSettings();
  const date = today();
  const data = useLiveQuery(async () => {
    const from = addDays(date, -21);
    const live = <T extends { deleted: 0 | 1 }>(r: T | undefined) => (r && r.deleted !== 1 ? r : undefined);
    const [checkin, night, nights, vitals, workouts, todos, anyCount] = await Promise.all([
      db.checkins.get(dayId.checkin(date)).then(live),
      db.sleepNights.get(dayId.sleep(date)).then(live),
      db.sleepNights.where('date').between(from, date, true, true).toArray().then(alive),
      db.dailyVitals.where('date').between(from, date, true, true).toArray().then(alive),
      db.workouts.where('date').between(startOfWeek(date), date, true, true).toArray().then(alive),
      db.todos.where('done').equals(0).toArray().then(alive),
      Promise.all([db.checkins.count(), db.workouts.count(), db.sleepNights.count()]).then((c) => c.reduce((a, b) => a + b, 0)),
    ]);
    const recentCheckins = alive(await db.checkins.where('date').between(addDays(date, -7), date, true, false).toArray());
    return { checkin, night, nights, vitals, workouts, todos, recentCheckins, anyData: anyCount > 0 };
  }, [date]);
  if (!data) return null;

  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const readiness = computeReadiness({
    date,
    checkin: data.checkin,
    night: data.night,
    vitals: data.vitals,
    sleepGoalHours: settings.goals.sleepHours,
    t: settings.readiness,
  });
  const goals = weeklyGoals(date, settings.goals, { workouts: data.workouts, vitals: data.vitals, nights: data.nights });
  const todaySteps = data.vitals.find((v) => v.date === date)?.steps;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{hello}</h1>
        <p className="mt-1 text-sm text-muted">{new Intl.DateTimeFormat('de-DE', { dateStyle: 'full' }).format(new Date())}</p>
      </header>

      {!data.anyData ? (
        <EmptyState
          title="Willkommen!"
          text="Noch keine Daten. Mach deinen ersten Check-in oder lade in den Einstellungen Demo-Daten, um alles auszuprobieren."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink to="/checkin" variant="primary">
                Check-in starten
              </ButtonLink>
              <ButtonLink to="/einstellungen">Demo-Daten laden</ButtonLink>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadinessTile r={readiness} hasCheckin={!!data.checkin} />
          <SleepTile night={data.night} nights={data.nights} goalHours={settings.goals.sleepHours} />
          <GoalsTile goals={goals} todaySteps={todaySteps} stepGoal={settings.goals.stepsPerDay} />
          <MoodTile checkin={data.checkin} recent={data.recentCheckins} />
          <TodosTile todos={data.todos} date={date} />
        </div>
      )}
    </>
  );
}

function ReadinessTile({ r, hasCheckin }: { r: ReadinessResult; hasCheckin: boolean }) {
  const s = STATUS_STYLE[r.status];
  return (
    <Card className="sm:col-span-2">
      <div className="flex items-center gap-4">
        <div
          className={cx('grid size-16 shrink-0 place-items-center rounded-full text-2xl font-bold', s.ring, r.status === 'unknown' ? 'text-muted' : 'text-bg')}
          aria-hidden
        >
          {s.icon}
        </div>
        <div>
          <p className="text-sm text-muted">Trainingsampel heute</p>
          <p className="text-xl font-semibold">
            <span className={s.text}>{s.label}</span> · {r.headline}
          </p>
          <p className="text-sm">{r.advice}</p>
        </div>
      </div>

      {r.factors.length > 0 && (
        <ul className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {r.factors.map((f) => {
            const l = LEVEL_STYLE[f.level];
            return (
              <li key={f.key} className="flex items-baseline gap-2 text-sm">
                <span className={cx('w-3 text-xs', l.cls)} aria-hidden>
                  {l.icon}
                </span>
                <span className="font-medium">{f.label}</span>
                <span className="text-muted">{f.detail}</span>
                <span className="sr-only">({l.label})</span>
              </li>
            );
          })}
        </ul>
      )}
      {r.missing.length > 0 && <p className="mt-2 text-xs text-muted">Nicht bewertet (keine Daten): {r.missing.join(', ')}</p>}
      {!hasCheckin && (
        <ButtonLink to="/checkin" variant="primary" className="mt-4 w-full">
          Check-in starten
        </ButtonLink>
      )}
      <p className="mt-3 text-xs text-muted">Orientierungshilfe, keine medizinische Beratung.</p>
    </Card>
  );
}

function SleepTile({ night, nights, goalHours }: { night?: SleepNight; nights: SleepNight[]; goalHours: number }) {
  if (!night) {
    return (
      <Card title="Schlaf letzte Nacht">
        <p className="text-sm text-muted">Noch keine Daten für letzte Nacht. Trag sie im Check-in ein.</p>
      </Card>
    );
  }
  const score = sleepScore(night, goalHours, nights);
  const goalMin = goalHours * 60;
  const hasPhases = night.deepMin !== undefined && night.remMin !== undefined;
  const phases = hasPhases
    ? [
        { label: 'Tief', min: night.deepMin ?? 0, cls: 'bg-accent' },
        { label: 'REM', min: night.remMin ?? 0, cls: 'bg-accent/60' },
        { label: 'Leicht', min: night.coreMin ?? 0, cls: 'bg-accent/25' },
        { label: 'Wach', min: night.awakeMin ?? 0, cls: 'bg-warn/70' },
      ]
    : [];
  const total = phases.reduce((s, p) => s + p.min, 0);

  return (
    <Card title="Schlaf letzte Nacht" action={<span className="text-sm text-muted">Score {score.score}</span>}>
      <p className="text-3xl font-semibold">{formatDuration(night.asleepMin)}</p>
      <p className="text-sm text-muted">
        {night.bedtime}–{night.wakeTime} · {night.asleepMin >= goalMin ? 'Ziel erreicht' : `${formatDuration(goalMin - night.asleepMin)} unter Ziel`}
      </p>
      {hasPhases && total > 0 && (
        <div className="mt-4">
          <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label="Schlafphasen">
            {phases.map((p) => (
              <div key={p.label} className={p.cls} style={{ width: `${(p.min / total) * 100}%` }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
            {phases.map((p) => (
              <span key={p.label} className="flex items-center gap-1">
                <span className={cx('inline-block size-2 rounded-full', p.cls)} />
                {p.label} {formatDuration(p.min)}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function GoalsTile({ goals, todaySteps, stepGoal }: { goals: GoalProgress[]; todaySteps?: number; stepGoal: number }) {
  return (
    <Card title="Wochenziele" action={<span className="text-xs text-muted">seit Montag</span>}>
      <ul className="space-y-3">
        {goals.map((g) => {
          const pct = g.target > 0 ? Math.min(100, (g.done / g.target) * 100) : 0;
          const reached = g.done >= g.target && g.target > 0;
          return (
            <li key={g.key}>
              <div className="flex justify-between text-sm">
                <span>
                  {g.label}
                  {g.optional && <span className="text-muted"> (optional)</span>}
                </span>
                <span className={cx('tabular-nums', reached ? 'font-medium text-good' : 'text-muted')}>
                  {reached && '✓ '}
                  {g.done}/{g.target}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface-2">
                <div className={cx('h-2 rounded-full', reached ? 'bg-good' : 'bg-accent')} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Schritte heute:{' '}
        <span className="font-medium text-fg tabular-nums">{todaySteps !== undefined ? todaySteps.toLocaleString('de-DE') : '–'}</span> /{' '}
        {stepGoal.toLocaleString('de-DE')}
      </p>
    </Card>
  );
}

function MoodTile({ checkin, recent }: { checkin?: Checkin; recent: Checkin[] }) {
  const avg = (k: 'mood' | 'energy' | 'stress') => (recent.length ? recent.reduce((s, c) => s + c[k], 0) / recent.length : undefined);
  const items: { key: 'mood' | 'energy' | 'stress'; label: string; higherIsBetter: boolean }[] = [
    { key: 'mood', label: 'Stimmung', higherIsBetter: true },
    { key: 'energy', label: 'Energie', higherIsBetter: true },
    { key: 'stress', label: 'Stress', higherIsBetter: false },
  ];
  return (
    <Card title="Wohlbefinden heute">
      {!checkin ? (
        <p className="text-sm text-muted">Noch kein Check-in heute.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {items.map((it) => {
              const a = avg(it.key);
              const diff = a === undefined ? 0 : checkin[it.key] - a;
              const better = it.higherIsBetter ? diff >= 1 : diff <= -1;
              const worse = it.higherIsBetter ? diff <= -1 : diff >= 1;
              return (
                <div key={it.key} className="rounded-xl bg-surface-2 p-3">
                  <p className="text-2xl font-semibold tabular-nums">{checkin[it.key]}</p>
                  <p className="text-xs text-muted">{it.label}</p>
                  {a !== undefined && (
                    <p className={cx('mt-1 text-xs', better ? 'text-good' : worse ? 'text-warn' : 'text-muted')}>
                      {diff > 0 ? '↑' : diff < 0 ? '↓' : '→'} Ø {a.toLocaleString('de-DE', { maximumFractionDigits: 1 })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {checkin.tags.length > 0 && <p className="mt-3 text-xs text-muted">Gestern: {checkin.tags.join(', ')}</p>}
          <p className="mt-1 text-xs text-muted">Vergleich mit dem Schnitt der letzten 7 Tage.</p>
        </>
      )}
    </Card>
  );
}

function TodosTile({ todos, date }: { todos: Todo[]; date: string }) {
  const sorted = sortOpenTodos(todos);
  const overdue = sorted.filter((t) => isOverdue(t, date)).length;
  return (
    <Card
      title="Offene To-Dos"
      className="sm:col-span-2"
      action={
        <Link to="/todos" className="text-sm text-accent">
          Alle ({sorted.length})
        </Link>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-muted">Nichts offen.</p>
      ) : (
        <>
          {overdue > 0 && <p className="mb-2 text-sm font-medium text-bad">{overdue} überfällig</p>}
          <ul className="divide-y divide-line">
            {sorted.slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate">{t.title}</span>
                <span className={cx('shrink-0 text-xs', isOverdue(t, date) ? 'text-bad' : 'text-muted')}>
                  {t.due ? formatDate(t.due) : t.category}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
