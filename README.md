# RTF – RoadToFTP

Web-App (PWA) fürs iPhone: erstellt einen periodisierten Radtrainingsplan passend zu deinem Ziel und
Leistungsstand, schickt die Einheiten über intervals.icu an Zwift und in deinen Kalender.
Läuft komplett im Browser; alle Daten bleiben auf dem Gerät (localStorage), kein Server nötig.

## Dateien
- `index.html` – Oberfläche (iPhone-optimiert, Dark Mode, Tab-Leiste unten)
- `planner.js` – Periodisierung, Workout-Bibliothek, Export als ZWO / ICS / intervals.icu-Workout-Text
- `app.js` – Speicher, intervals.icu-API, Strava-OAuth, Bedienung
- `sw.js`, `manifest.webmanifest`, `*.png` – Offline-Betrieb und Home-Bildschirm-Symbol

## Veröffentlichen über GitHub Pages (einmalig, ohne Programme)
1. Auf https://github.com anmelden → **New repository**, Name z. B. `rtf`, Sichtbarkeit **Public**
   (GitHub Pages ist im kostenlosen Tarif nur für öffentliche Repositories verfügbar; der Code enthält keine persönlichen Daten).
2. Im neuen Repository **Add file → Upload files**, alle Dateien aus diesem Ordner hineinziehen, **Commit changes**.
3. **Settings → Pages → Branch: main / (root) → Save**. Nach 1–2 Minuten ist die App unter
   `https://<dein-name>.github.io/rtf/` erreichbar.
4. Auf dem iPhone diese Adresse in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm**.

Updates: geänderte Dateien wieder per „Upload files“ hochladen; die App lädt die neue Version beim nächsten Start.

## Einrichtung in der App
1. **Ziel**: Zieltyp, eigener Name, optional Eventdatum und Ziel-FTP, Trainingstage mit Dauer/Uhrzeit → *Plan erstellen*.
2. **Leistung → intervals.icu**: API-Key aus intervals.icu (*Settings → Developer Settings*) eintragen,
   *Leistungsdaten laden*. In intervals.icu vorher Garmin und Zwift verbinden.
   Optional **Strava**: eigene API-App auf strava.com/settings/api, Callback Domain = `<dein-name>.github.io`.
3. **Zwift & Kalender**: *Plan an intervals.icu & Zwift senden*. intervals.icu überträgt jeweils die nächsten
   7 Tage an Zwift (Custom Workouts). Für den iPhone-Kalender die iCal-Adresse aus intervals.icu abonnieren
   oder die `.ics`-Datei verwenden.

Hinweis: Eine App auf dem Home-Bildschirm hat auf iOS einen eigenen Speicher, getrennt von Safari.
Falls die Strava-Anmeldung in Safari landet, zeigt RTF dort den Code an; diesen in der App unter *Code einfügen* eintragen.
