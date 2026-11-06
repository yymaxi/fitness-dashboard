import { describe, expect, it } from 'vitest';
import type { ImportRule } from '../../data/db';
import {
  buildHealthImport,
  dailySteps,
  groupSleepNights,
  HealthCollector,
  hrvDuringSleep,
  mapWorkout,
  median,
  parseHealthDate,
  type HealthRaw,
  type RawWorkout,
  type SleepSegment,
  type SleepStage,
} from '../health';
import { XmlTagStream } from '../xmlStream';
import { hrv, sleep, steps, wrap } from './fixture';

const t = (s: string) => parseHealthDate(s)!;
const seg = (stage: SleepStage, start: string, end: string): SleepSegment => ({ stage, start: t(`${start} +0100`), end: t(`${end} +0100`) });

function collect(xml: string, sleepSource = 'Zepp'): HealthRaw {
  const c = new HealthCollector({ sleepSource });
  const s = new XmlTagStream(c.onTag);
  s.push(xml);
  s.end();
  return c.raw;
}

const zeppOther: ImportRule = {
  id: 'rule-zepp-other', source: 'Zepp', match: 'HKWorkoutActivityTypeOther', workoutType: 'mobility', label: 'Dehnen', updatedAt: 0, deleted: 0,
};

describe('parseHealthDate', () => {
  it('nimmt die Wanduhrzeit und berechnet den absoluten Zeitpunkt', () => {
    const a = t('2026-11-05 23:30:00 +0100');
    expect(a).toMatchObject({ date: '2026-11-05', time: '23:30' });
    expect(a.ms).toBe(Date.UTC(2026, 10, 5, 22, 30));
    // Sommerzeit: gleiche UTC-Zeit, andere Wanduhrzeit
    expect(t('2026-07-01 08:00:00 +0200').ms).toBe(Date.UTC(2026, 6, 1, 6, 0));
    expect(parseHealthDate('kaputt')).toBeNull();
  });
});

describe('Schlaf zu Nächten gruppieren', () => {
  it('fasst Phasen einer Nacht zusammen und ordnet sie dem Aufwachtag zu', () => {
    const nights = groupSleepNights([
      seg('inBed', '2026-11-05 22:50:00', '2026-11-06 07:10:00'),
      seg('core', '2026-11-05 23:10:00', '2026-11-06 01:00:00'),
      seg('deep', '2026-11-06 01:00:00', '2026-11-06 02:30:00'),
      seg('awake', '2026-11-06 02:30:00', '2026-11-06 02:45:00'),
      seg('rem', '2026-11-06 02:45:00', '2026-11-06 04:00:00'),
      seg('core', '2026-11-06 04:00:00', '2026-11-06 06:40:00'),
    ]);
    expect(nights).toHaveLength(1);
    const n = nights[0]!;
    expect(n).toMatchObject({ id: 'sl-2026-11-06', date: '2026-11-06', bedtime: '23:10', wakeTime: '06:40', source: 'apple-health' });
    // InBed wird ignoriert, weil Phasen da sind: Bettzeit = erste Phase, nicht 22:50
    expect(n.asleepMin).toBe(110 + 90 + 75 + 160);
    expect(n).toMatchObject({ coreMin: 270, deepMin: 90, remMin: 75, awakeMin: 15 });
  });

  it('nutzt InBed, wenn eine Nacht keine Phasen hat', () => {
    const [n] = groupSleepNights([seg('inBed', '2026-11-05 23:00:00', '2026-11-06 06:30:00')]);
    expect(n).toMatchObject({ date: '2026-11-06', bedtime: '23:00', wakeTime: '06:30', asleepMin: 450 });
    expect(n!.deepMin).toBeUndefined();
  });

  it('trennt Nächte und lässt Mittagsschlaf außen vor', () => {
    const nights = groupSleepNights([
      seg('core', '2026-11-04 23:00:00', '2026-11-05 06:00:00'),
      seg('core', '2026-11-05 14:00:00', '2026-11-05 14:40:00'), // Mittagsschlaf, zu kurz
      seg('core', '2026-11-05 23:30:00', '2026-11-06 03:00:00'),
      seg('core', '2026-11-06 04:00:00', '2026-11-06 07:00:00'), // 1 h wach dazwischen, gleiche Nacht
    ]);
    expect(nights.map((n) => [n.date, n.asleepMin, n.bedtime, n.wakeTime])).toEqual([
      ['2026-11-05', 420, '23:00', '06:00'],
      ['2026-11-06', 390, '23:30', '07:00'],
    ]);
  });

  it('zählt überlappende Einträge nur einmal', () => {
    const [n] = groupSleepNights([
      seg('asleep', '2026-11-05 23:00:00', '2026-11-06 03:00:00'),
      seg('asleep', '2026-11-06 02:00:00', '2026-11-06 06:00:00'),
    ]);
    expect(n!.asleepMin).toBe(420);
  });

  it('übernimmt Schlaf nur aus der gewählten Quelle', () => {
    const raw = collect(wrap([
      sleep('Zepp Life', 'AsleepCore', '2026-11-05 23:00:00 +0100', '2026-11-06 06:00:00 +0100'),
      sleep('Apple Watch von Max', 'AsleepCore', '2026-11-05 22:00:00 +0100', '2026-11-06 07:00:00 +0100'),
      sleep('iPhone', 'InBed', '2026-11-05 22:00:00 +0100', '2026-11-06 07:00:00 +0100'),
    ].join('\n')));
    expect(raw.sleep).toHaveLength(1);
    expect(groupSleepNights(raw.sleep)[0]).toMatchObject({ bedtime: '23:00', asleepMin: 420 });
  });
});

describe('Schritte', () => {
  it('summiert pro Quelle und nimmt pro Tag das Maximum (iPhone + Zepp)', () => {
    const raw = collect(wrap([
      steps('iPhone von Max', '2026-11-05 08:00:00 +0100', '2026-11-05 09:00:00 +0100', 3000),
      steps('iPhone von Max', '2026-11-05 17:00:00 +0100', '2026-11-05 18:00:00 +0100', 4000),
      steps('Zepp', '2026-11-05 08:00:00 +0100', '2026-11-05 12:00:00 +0100', 5000),
      steps('Zepp', '2026-11-05 12:00:00 +0100', '2026-11-05 20:00:00 +0100', 3500),
      steps('iPhone von Max', '2026-11-06 08:00:00 +0100', '2026-11-06 09:00:00 +0100', 1200),
    ].join('\n')));
    const d = dailySteps(raw.steps);
    expect(d.get('2026-11-05')).toEqual({ steps: 8500, source: 'Zepp' });
    expect(d.get('2026-11-06')).toEqual({ steps: 1200, source: 'iPhone von Max' });
  });
});

describe('HRV', () => {
  it('Median nur aus Messungen während des Schlafs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();

    const raw = collect(wrap([
      sleep('Zepp', 'AsleepCore', '2026-11-05 23:00:00 +0100', '2026-11-06 06:00:00 +0100'),
      hrv('Zepp', '2026-11-05 21:00:00 +0100', 20), // vor dem Schlaf
      hrv('Zepp', '2026-11-06 00:10:00 +0100', 50),
      hrv('Zepp', '2026-11-06 02:10:00 +0100', 70),
      hrv('Zepp', '2026-11-06 04:10:00 +0100', 40),
      hrv('Zepp', '2026-11-06 05:10:00 +0100', 64),
      hrv('Zepp', '2026-11-06 12:00:00 +0100', 15), // tagsüber
    ].join('\n')));
    const nights = groupSleepNights(raw.sleep);
    expect(hrvDuringSleep(nights, raw.hrv).get('2026-11-06')).toBe(57);
  });
});

describe('Workouts', () => {
  const raw: RawWorkout = {
    activityType: 'HKWorkoutActivityTypeOther', source: 'Zepp', start: t('2026-11-05 18:00:00 +0100'), end: t('2026-11-05 18:20:00 +0100'), durationMin: 20.4,
  };

  it('ordnet Zepp „Other“ per Regel Mobility zu', () => {
    expect(mapWorkout(raw, [zeppOther])).toMatchObject({ type: 'mobility', label: 'Dehnen', durationMin: 20, date: '2026-11-05', start: '18:00' });
    expect(mapWorkout({ ...raw, source: 'Apple Watch' }, [zeppOther]).type).toBe('other');
    expect(mapWorkout(raw, [{ ...zeppOther, deleted: 1 }]).type).toBe('other');
  });

  it('hat eine stabile externalId und ID', () => {
    const a = mapWorkout(raw, []);
    const b = mapWorkout({ ...raw, start: t('2026-11-05 17:00:00 +0000') }, []); // gleicher Zeitpunkt, andere Zone
    expect(a.externalId).toBe(b.externalId);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^wo-ah-[0-9a-f]{8}$/);
  });

  it('liest altes und neues Exportformat (Attribute bzw. WorkoutStatistics)', () => {
    const xml = wrap(`
<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="0.5" durationUnit="h" totalDistance="3.1" totalDistanceUnit="mi" totalEnergyBurned="1255" totalEnergyBurnedUnit="kJ" sourceName="Zepp" startDate="2026-11-01 08:00:00 +0100" endDate="2026-11-01 08:30:00 +0100"/>
<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="31.2" durationUnit="min" sourceName="Zepp" startDate="2026-11-03 08:00:00 +0100" endDate="2026-11-03 08:31:12 +0100">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-11-03 08:00:00 +0100" endDate="2026-11-03 08:31:12 +0100" sum="320" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="2026-11-03 08:00:00 +0100" endDate="2026-11-03 08:31:12 +0100" sum="5240" unit="m"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-11-03 08:00:00 +0100" endDate="2026-11-03 08:31:12 +0100" average="148.6" minimum="90" maximum="170" unit="count/min"/>
  <WorkoutRoute sourceName="Zepp"><FileReference path="/workout-routes/route_2026-11-03.gpx"/></WorkoutRoute>
</Workout>
<Workout workoutActivityType="HKWorkoutActivityTypeOther" duration="15" durationUnit="min" sourceName="Zepp" startDate="2026-11-04 20:00:00 +0100" endDate="2026-11-04 20:15:00 +0100"></Workout>`);
    const result = buildHealthImport(collect(xml), [zeppOther]);
    expect(result.workouts.map((w) => [w.date, w.type, w.label, w.durationMin, w.distanceKm, w.kcal, w.avgHr])).toEqual([
      ['2026-11-01', 'cardio', 'Laufen', 30, 4.99, 300, undefined],
      ['2026-11-03', 'cardio', 'Laufen', 31, 5.24, 320, 149],
      ['2026-11-04', 'mobility', 'Dehnen', 15, undefined, undefined, undefined],
    ]);
  });

  it('entfernt doppelte Workouts innerhalb eines Exports', () => {
    const w = `<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="40" durationUnit="min" sourceName="Zepp" startDate="2026-11-01 08:00:00 +0100" endDate="2026-11-01 08:40:00 +0100"/>`;
    expect(buildHealthImport(collect(wrap(w + w)), []).workouts).toHaveLength(1);
  });
});

describe('buildHealthImport', () => {
  it('kombiniert Schritte, HRV und Ruhepuls zu Tageswerten', () => {
    const xml = wrap([
      sleep('Zepp', 'AsleepDeep', '2026-11-05 23:00:00 +0100', '2026-11-06 06:00:00 +0100'),
      hrv('Zepp', '2026-11-06 02:00:00 +0100', 48.26),
      steps('iPhone', '2026-11-06 08:00:00 +0100', '2026-11-06 09:00:00 +0100', 900),
      '<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Zepp" unit="count/min" startDate="2026-11-06 07:00:00 +0100" endDate="2026-11-06 07:00:00 +0100" value="51"/>',
      '<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Zepp" unit="count/min" startDate="2026-11-06 19:00:00 +0100" endDate="2026-11-06 19:00:00 +0100" value="54"/>',
      '<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Zepp" unit="count/min" startDate="2026-11-06 07:00:00 +0100" endDate="2026-11-06 07:00:00 +0100" value="80"/>',
    ].join('\n'));
    const r = buildHealthImport(collect(xml), []);
    expect(r.sleepNights).toHaveLength(1);
    expect(r.sleepNights[0]).not.toHaveProperty('startMs');
    expect(r.dailyVitals).toEqual([
      { id: 'vt-2026-11-06', date: '2026-11-06', source: 'apple-health', steps: 900, stepsSource: 'iPhone', hrvSdnnMs: 48.3, restingHr: 53 },
    ]);
  });
});
