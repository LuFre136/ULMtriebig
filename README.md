# ULMtriebig

Web-App (PWA) fürs iPhone: zeigt anstehende Events im Umkreis. Kostenlos gehostet auf GitHub Pages.

- Standard: Ulm, 5 km, Konzerte/Sport/Märkte/Partys (alles in den Einstellungen änderbar, wird auf dem Gerät gespeichert)
- Installieren: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“

## Datenquellen
| Quelle | Inhalt | Kosten/Grenzen |
|---|---|---|
| [Veranstaltungskalender Ulm/Neu-Ulm](https://datenhub.ulm.de/ckan/gl/dataset/veranstaltungsdaten-in-ulm-und-neu-ulm) (RSS, CC0) | Region Ulm/Neu-Ulm, alle Kategorien | frei, nur heute + 9 Tage, keine Koordinaten |
| [Ticketmaster Discovery API](https://developer.ticketmaster.com/) | große Konzerte, Sport | kostenloser Key, 5000 Abrufe/Tag; optional |
| [Nominatim/OpenStreetMap](https://nominatim.org/) | Adressen → Koordinaten, Ortssuche | frei, max. 1 Abruf/s (wird gecacht) |

Eine GitHub Action (`.github/workflows/update-events.yml`) holt die Daten dreimal täglich und schreibt `data/events.json`.

## Einrichtung
1. Repo auf GitHub anlegen, Dateien pushen.
2. Settings → Pages → „Deploy from a branch“, Branch `main`, Ordner `/`.
3. Optional: Ticketmaster-Key als Secret `TICKETMASTER_API_KEY` (Settings → Secrets → Actions).
4. Actions → „Events aktualisieren“ → „Run workflow“.

## Lokal testen
```
LEO_FIXTURE=test/leo-sample.xml NO_GEOCODE=1 node scripts/fetch-events.mjs
python3 -m http.server
```
