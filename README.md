# Fitness Dashboard

Persönliches Dashboard für Schlaf, Regeneration, Wohlbefinden, Training und To-Dos.
Läuft komplett im Browser (auch offline als installierbare PWA). Daten bleiben auf dem Gerät und lassen sich
verschlüsselt über die eigene Dropbox zwischen Handy und PC abgleichen.

> Die Trainingsempfehlung (Ampel) ist eine Orientierungshilfe, keine medizinische Beratung.

## Stand

| Milestone | Inhalt | Status |
|---|---|---|
| 1 | Datenmodell, Speicherung, Check-in, Training, To-Dos, Körper, Demo-Daten | ✅ |
| 2 | Startseite mit Kacheln, Ampel, Schlaf-Score, Wochenzielen | ✅ |
| 3 | Detailseiten, Diagramme, Trends, Zusammenhänge, PRs | offen |
| 4 | Apple-Health-Import, JSON-Backup, PWA, Dropbox-Sync | ✅ |
| 5 | Wochenrückblick, Einstellungen, CSV-Import/-Export, Feinschliff | offen |

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
  import/      Apple-Health-Import: Zip-/XML-Streaming, Web Worker, Umrechnung, Übernahme in die DB + Tests
  sync/        Zusammenführen, JSON-Backup, Verschlüsselung, Dropbox-Client, Sync-Ablauf + Tests
  components/  Layout, Navigation, UI-Bausteine, Hooks
  features/    Seiten: checkin, dashboard, training, todos, body, data (Daten & Sync), settings
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

## Apple-Health-Import (`src/import/`)

In der Health-App „Alle Gesundheitsdaten exportieren“ und die `export.zip` unter **Daten & Sync** auswählen.
Die Datei wird in einem Web Worker gestreamt (Zip → Inflate → XML-Tags), es liegt nie der ganze Export im
Speicher – auch mehrere GB große Exporte funktionieren. Nichts verlässt das Gerät.

| Daten | Regel |
|---|---|
| Schlaf | Nur Einträge der Schlafquelle (Standard „Zepp“). Abschnitte mit < 2 h Abstand bilden eine Nacht, zugeordnet zum Aufwachtag; pro Tag zählt die längste Gruppe (Mittagsschlaf fällt raus), unter 2 h Schlaf ist keine Nacht. Hat eine Nacht Phasen (Kern/Tief/REM/Wach), werden „InBed“-Einträge ignoriert, sonst gilt InBed als Schlafzeit. Überlappungen zählen einmal. |
| Schritte | Pro Tag und Quelle summiert, dann das Maximum über alle Quellen (iPhone und Zepp zählen dieselben Schritte). |
| HRV | Median aller SDNN-Werte zwischen Einschlafen und Aufwachen, gespeichert am Aufwachtag. |
| Ruhepuls | Tagesmittel. |
| Workouts | Stabile `externalId` (Quelle, Aktivität, Startzeitpunkt) und daraus abgeleitete ID – erneute Importe erzeugen keine Duplikate, bearbeitete oder gelöschte Einheiten bleiben unangetastet. Zuordnung über `importRules`, Standard: Zepp „Other“ → Mobility („Dehnen“). Regeln sind unter Daten & Sync editierbar. |

Importierte Nächte ersetzen die grobe Schätzung aus dem Check-in, von dir gelöschte Einträge bleiben gelöscht.
`updatedAt` ändert sich nur bei echten Änderungen, damit der Sync nichts Unverändertes überträgt.

## Backup (`src/sync/snapshot.ts`)

JSON-Datei mit allen Tabellen inklusive Löschmarkierungen. Wiederherstellen per **Zusammenführen**
(pro Datensatz gewinnt die neuere Änderung) oder **Alles ersetzen**.

## Dropbox-Sync (`src/sync/`)

- **Anmeldung:** OAuth 2 mit PKCE, ohne Server und ohne App-Secret (App key `f7rve0x5l74te9d`).
  Die App sieht nur ihren App-Ordner; Tokens liegen im `localStorage` des Geräts.
- **Verschlüsselung:** Die Sync-Datei `/fitness-dashboard.sync` wird gzip-komprimiert und mit AES-GCM-256
  verschlüsselt; der Schlüssel entsteht per PBKDF2-SHA256 (600 000 Runden) aus dem Sync-Passwort. Das Passwort
  wird nie gespeichert – nur der daraus abgeleitete, nicht exportierbare Schlüssel in IndexedDB.
  **Ohne Passwort sind die Sync-Daten nicht wiederherstellbar.**
- **Zusammenführen:** pro Datensatz nach `updatedAt` (neuere Änderung gewinnt, Löschungen über `deleted = 1`).
  Hochgeladen wird mit der zuvor gelesenen Revision; war ein anderes Gerät schneller, wird neu zusammengeführt.
- **Demo-Daten** (`updatedAt = 1`) werden nie hochgeladen; ein echter Eintrag desselben Tages ersetzt sie.
- **Automatisch:** beim Start, beim Zurückkehren zur App (höchstens minütlich) und alle 30 s, wenn es lokale Änderungen gibt.

Einmalig in der [Dropbox App Console](https://www.dropbox.com/developers/apps) für die App eintragen:

- **Permissions:** `files.content.read` und `files.content.write`
- **Redirect URIs:** `https://<github-user>.github.io/fitness-dashboard/` und `http://localhost:5173/`

## PWA

`vite-plugin-pwa` erzeugt Manifest und Service Worker (alle App-Dateien werden vorgeladen, die App läuft offline).
Neue Versionen werden im Hintergrund geladen und beim nächsten Start aktiv. Installieren: im Browser
„Zum Home-Bildschirm“ bzw. „App installieren“.
