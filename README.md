# Fitness Dashboard

Persönliches Dashboard für Schlaf, Regeneration, Wohlbefinden, Training und To-Dos.
Läuft komplett im Browser, Daten bleiben auf dem Gerät (Sync über die eigene Dropbox folgt).

> Die Trainingsempfehlung (Ampel) ist eine Orientierungshilfe, keine medizinische Beratung.

## Stand

| Milestone | Inhalt | Status |
|---|---|---|
| 1 | Datenmodell, Speicherung, Check-in, Training, To-Dos, Körper, Demo-Daten | ✅ |
| 2 | Startseite mit Kacheln, Ampel, Schlaf-Score, Wochenzielen | ✅ |
| 3 | Detailseiten, Diagramme, Trends, Zusammenhänge, PRs | offen |
| 4 | Apple-Health-Import, CSV-Import/-Export, Backup, Dropbox-Sync | offen |
| 5 | Wochenrückblick, Einstellungen, Feinschliff | offen |

## Setup

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run typecheck  # TypeScript strict
npm run build      # Produktions-Build nach dist/
```

Jeder Push auf `main` wird getestet und automatisch auf GitHub Pages veröffentlicht
(`.github/workflows/deploy.yml`). Einmalig nötig: im Repository unter
**Settings → Pages → Build and deployment → Source** „GitHub Actions“ auswählen.

## Aufbau

```
src/
  domain/      reine Logik ohne UI (Datumsfunktionen, Check-in-Vorbelegung, Training, To-Dos) + Tests
  data/        Dexie-Datenbank, Schema-Versionen, Standardwerte, Demo-Daten
  components/  Layout, Navigation, UI-Bausteine, Hooks
  features/    Seiten: checkin, dashboard, training, todos, body, settings
```

## Datenmodell

Alle Datensätze haben `id`, `updatedAt` (ms) und `deleted` (0/1, Löschmarkierung für den Sync).
Interne Einheiten: kg, km, Minuten; Datum als lokales `YYYY-MM-DD`, Uhrzeit als `HH:MM`.

| Tabelle | Inhalt |
|---|---|
| `checkins` | Tageswerte 1–10: Erholung, Muskelkater, Stimmung, Energie, Stress, Schlafqualität; Kniebeschwerden 0–10; Tags, Notiz. ID `ci-<Datum>` |
| `sleepNights` | Nacht pro Aufwachtag: Bett-/Aufwachzeit, Schlafminuten, Phasen. ID `sl-<Datum>` |
| `dailyVitals` | Ruhepuls, HRV (SDNN), Schritte. ID `vt-<Datum>` |
| `workouts` | Einheit: Art (Kraft/Ausdauer/Mobility/Sonstiges), Dauer, RPE, Distanz, Puls, Vorlage |
| `workoutSets` | Sätze: Übung, Wiederholungen, Gewicht |
| `exercises`, `templates` | Übungen mit Muskelgruppe; Vorlagen Push/Pull (ohne Beine) |
| `todos` | Aufgabe mit Fälligkeit, Priorität, Kategorie, optional geplanter Vorlage |
| `bodyMetrics` | Gewicht, Bauchumfang |
| `importRules` | Zuordnung beim Import (z. B. Zepp „Sonstiges“ → Mobility) |
| `settings` | Ziele, Ampel-Schwellen, Einheiten, Theme |

Tages-IDs sind absichtlich stabil: Handy und PC erzeugen für denselben Tag dieselbe ID, so lassen sich
Änderungen beim Sync eindeutig zusammenführen (neuere Änderung gewinnt).

**Migrationen:** Neue Schema-Versionen werden in `src/data/db.ts` als `this.version(n)` angehängt,
bestehende Versionen werden nie verändert.

**Demo-Daten** tragen `updatedAt = 1`. Sie überschreiben keine eigenen Einträge, lassen sich gezielt
wieder entfernen und werden später nicht synchronisiert.

## Ampel-Logik (`src/domain/readiness.ts`)

Jeder Faktor wird als gut / mittel / schlecht bewertet (Schwellen in `settings.readiness`):
Schlaf im Verhältnis zum Ziel (gut ≥ 90 %, schlecht < 75 %), Erholung (gut ≥ 7, schlecht ≤ 4),
Muskelkater (gut ≤ 4, schlecht ≥ 7), Ruhepuls über dem 14-Tage-Schnitt (mittel ab +3, schlecht ab +6 bpm),
HRV unter dem 14-Tage-Schnitt (mittel ab −10 %, schlecht ab −20 %), optional Knie (mittel ab 3, schlecht ab 5).
Ruhepuls und HRV werden erst ab 5 Vergleichswerten bewertet.

**Rot** = mindestens zwei Faktoren schlecht · **Gelb** = einer schlecht oder zwei mittel · **Grün** = sonst.

## Schlaf-Score (`src/domain/sleepScore.ts`)

0–100 Punkte aus Dauer (50, linear bis zum Ziel), Tief- + REM-Anteil (15, voll ab 40 %),
wenig Wachphasen (15, voll bis 5 % Wachanteil) und Regelmäßigkeit (20, Einschlafzeit gegen den
eigenen 14-Tage-Schnitt, 0 Punkte ab 90 min Abweichung). Fehlende Teile werden weggelassen und
die übrigen auf 100 hochgerechnet.
