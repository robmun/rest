# Tafels

Mijn favoriete restaurants in Amsterdam, Utrecht en rond kantoor, als app op mijn iPhone. Met lijst, kaart, notities en kenmerken (zakelijk, Italiaans, lunch, …).

## Hoe het werkt

- **De app** staat op de tak `main` en wordt via GitHub Pages gepubliceerd op https://robmun.github.io/rest/.
- **De lijst** staat als `restaurants.json` op de tak `data`. De app leest en schrijft dat bestand zelf via de GitHub-API; de toegang zit ingebouwd, dus er hoeft niemand in te loggen.
- Elke wijziging wordt een commit op de tak `data`, dus alles is terug te zetten.
- De kaart gebruikt OpenStreetMap. Locaties worden automatisch opgezocht (Nominatim) en in `restaurants.json` bewaard. Staat een pin verkeerd, open het restaurant en tik op de juiste plek.

## Installeren

Open https://robmun.github.io/rest/ in Safari op de iPhone → deel-knop → **Zet op beginscherm**. Meer is niet nodig.

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html`, `app.css`, `app.js` | De app |
| `sw.js`, `manifest.webmanifest`, `*.png` | Installeerbaar en offline bruikbaar |

Formaat van `restaurants.json`: `{ version, cities[], inspiration[], items[] }`, waarbij elk item `id, name, url, city, notes, tags[], visited, address?, lat?, lng?, updatedAt` heeft. Verwijderde items blijven als `{ id, deleted: true }` staan, zodat twee apparaten elkaars wijzigingen goed samenvoegen.

## Versies

Nummering `jaar.maand.volgnummer`, bijvoorbeeld `26.9.1` = eerste versie van september 2026.
Het versienummer staat in `app.js` (`APP_VERSION`) en in `sw.js` (`CACHE`), en is te zien onder Instellingen.

| Versie | Datum | Wat |
|---|---|---|
| 26.9.3 | 29-09-2026 | Nieuwe versies worden altijd volledig geladen (knoppen tekstgrootte werkten niet door oude code in de cache) |
| 26.9.2 | 29-09-2026 | Tekst één stap groter; tekstgrootte instelbaar onder Instellingen |
| 26.9.1 | 29-09-2026 | Eerste genummerde versie: kaart en lijst, bezoekhistorie, snel toevoegen, export, bekijkversie, leesbaardere tekst |
