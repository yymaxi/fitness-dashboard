import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { alive, dayId } from '../../data/repo';
import { formatDuration, startOfWeek, today } from '../../domain/dates';
import { ButtonLink, Card, EmptyState, PageHeader } from '../../components/ui';

/** Vorläufige Startseite. Die Kacheln mit Ampel kommen in Milestone 2. */
export function DashboardPage() {
  const date = today();
  const data = useLiveQuery(async () => {
    const checkin = await db.checkins.get(dayId.checkin(date));
    const night = await db.sleepNights.get(dayId.sleep(date));
    const week = alive(await db.workouts.where('date').between(startOfWeek(date), date, true, true).toArray());
    const openTodos = alive(await db.todos.where('done').equals(0).toArray()).length;
    const anyData = (await db.checkins.count()) + (await db.workouts.count()) > 0;
    return { checkin: checkin?.deleted ? undefined : checkin, night: night?.deleted ? undefined : night, week, openTodos, anyData };
  }, [date]);
  if (!data) return null;

  const hello = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Hallo' : 'Guten Abend';

  return (
    <>
      <PageHeader title={hello} subtitle={new Intl.DateTimeFormat('de-DE', { dateStyle: 'full' }).format(new Date())} />
      {!data.checkin && (
        <Card className="mb-4 border-accent">
          <p className="font-medium">Noch kein Check-in heute</p>
          <p className="mt-1 text-sm text-muted">Dauert unter 30 Sekunden.</p>
          <ButtonLink to="/checkin" variant="primary" className="mt-3 w-full">
            Check-in starten
          </ButtonLink>
        </Card>
      )}
      {!data.anyData ? (
        <EmptyState
          title="Willkommen!"
          text="Noch keine Daten. Mach deinen ersten Check-in oder lade in den Einstellungen Demo-Daten, um alles auszuprobieren."
          action={<ButtonLink to="/einstellungen">Zu den Einstellungen</ButtonLink>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Schlaf letzte Nacht">
            <p className="text-2xl font-semibold">{data.night ? formatDuration(data.night.asleepMin) : '–'}</p>
          </Card>
          <Card title="Training diese Woche">
            <p className="text-2xl font-semibold">{data.week.length} Einheiten</p>
          </Card>
          <Card title="Offene To-Dos">
            <p className="text-2xl font-semibold">{data.openTodos}</p>
          </Card>
          <Card title="Stimmung heute">
            <p className="text-2xl font-semibold">{data.checkin ? `${data.checkin.mood}/10` : '–'}</p>
          </Card>
        </div>
      )}
      <p className="mt-6 text-xs text-muted">Vorschau – die richtige Startseite mit Ampel und Wochenzielen kommt in Milestone 2.</p>
    </>
  );
}
