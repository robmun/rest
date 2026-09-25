# Tafels

Mijn favoriete restaurants in Amsterdam, Utrecht en rond kantoor, als app op mijn iPhone. Met lijst, kaart, notities en kenmerken (zakelijk, Italiaans, lunch, …).

## Hoe het werkt

- **De app** (deze repository) staat publiek op GitHub Pages. Er staan geen persoonlijke gegevens in.
- **De lijst zelf** staat als `restaurants.json` in een **privé** repository (bijv. `tafels-data`). De app leest en schrijft dat bestand via de GitHub-API met een toegangstoken dat alleen op je telefoon staat.
- Elke wijziging wordt een commit in de privé repository, dus je hebt automatisch een volledige geschiedenis.
- De kaart gebruikt OpenStreetMap. Locaties worden één keer automatisch opgezocht (via Nominatim) en in `restaurants.json` bewaard. Zit een pin verkeerd, open het restaurant en tik op de juiste plek.

## Installeren

1. **GitHub Pages aanzetten** voor deze repository: *Settings → Pages → Deploy from a branch → `main` / root*.
2. **Token maken**: *GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token*
   - Repository access: *Only select repositories* → alleen `tafels-data`
   - Permissions: *Contents: Read and write*
   - Kies een lange geldigheid (bijv. 1 jaar).
3. Open `https://<gebruikersnaam>.github.io/tafels/` in **Safari** op je iPhone → deel-knop → **Zet op beginscherm**.
4. Open de app vanaf je beginscherm, tik rechtsboven op de statusknop en vul in: gebruikersnaam, `tafels-data`, en het token. Klaar.

Let op: een app op het beginscherm heeft op iPhone een eigen opslag, los van Safari. Vul het token dus in ín de app op je beginscherm.

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html`, `app.css`, `app.js` | De app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installeerbaar en offline bruikbaar |

Formaat van `restaurants.json`: `{ version, cities[], inspiration[], items[] }`, waarbij elk item `id, name, url, city, notes, tags[], visited, address?, lat?, lng?, updatedAt` heeft. Verwijderde items blijven als `{ id, deleted: true }` staan, zodat twee apparaten elkaars wijzigingen goed samenvoegen.
