# LinkedIn → Google Contacts

Een webapp van één bestand. Hij vergelijkt je LinkedIn-connecties met je Google-contacten, en jij kiest per persoon (en per veld) wat er in Google Contacts wordt bijgewerkt of toegevoegd. Alles draait in je browser. De gegevens gaan alleen naar Google zelf.

Je doet de installatie hieronder één keer. Reken op zo'n 20 minuten.

---

## Deel 1 — Op GitHub zetten

1. Ga naar https://github.com/new
   - Repository name: `linkedin-google-contacts`
   - Kies **Public**. GitHub Pages is alleen gratis voor openbare repo's. Het staat er alleen de code; er gaan geen contactgegevens mee.
   - Klik **Create repository**.
2. Klik op de pagina van je nieuwe repo op **uploading an existing file**, sleep `index.html` en `README.md` erin en klik **Commit changes**.
3. Ga naar **Settings → Pages**.
   - Source: **Deploy from a branch**
   - Branch: **main**, map **/ (root)** → **Save**
4. Wacht 1–2 minuten en ververs de pagina. Bovenaan zie je dan het adres, bijvoorbeeld
   `https://robertmunnichs.github.io/linkedin-google-contacts/`
   Noteer het. Het deel `https://robertmunnichs.github.io` (zonder alles wat erachter komt) heb je straks nodig.

## Deel 2 — Google Cloud instellen

1. **Project aanmaken.** Ga naar https://console.cloud.google.com/, klik bovenaan op de projectkiezer → **Nieuw project** → naam `LinkedIn Contacts` → **Maken**. Kijk of dit project nu bovenaan geselecteerd is.
2. **People API aanzetten.** Ga naar **API's en services → Bibliotheek**, zoek **Google People API** en klik **Inschakelen**.
3. **Toestemmingsscherm (OAuth) instellen.** Ga naar **API's en services → OAuth-toestemmingsscherm** (in het nieuwe menu heet dit **Google Auth Platform**) en klik **Aan de slag**.
   - App-naam: `LinkedIn Contacts`, ondersteuningsmail: je Gmail-adres
   - Doelgroep: **Extern**
   - Contactgegevens: je Gmail-adres → akkoord → **Maken**
4. **Jezelf als testgebruiker toevoegen.** Ga naar **Doelgroep** (Audience) → **Testgebruikers → + Gebruikers toevoegen** → vul je eigen Gmail-adres in → **Opslaan**.
   Laat de app op **Testen** staan. Je hoeft hem niet te laten verifiëren door Google.
5. **Client-ID maken.** Ga naar **Clients** (of **Inloggegevens → + Inloggegevens maken → OAuth-client-ID**).
   - Toepassingstype: **Webapplicatie**
   - Naam: `GitHub Pages`
   - **Geautoriseerde JavaScript-bronnen** → **+ URI toevoegen** → `https://robertmunnichs.github.io`
     (alleen dit deel, zonder `/linkedin-google-contacts/` en zonder schuine streep aan het eind)
   - Omleidings-URI's: leeg laten → **Maken**
6. Kopieer de **Client-ID**. Die eindigt op `.apps.googleusercontent.com`. Het client-geheim (secret) heb je niet nodig.

Het kan tot 5 minuten duren voordat een nieuwe JavaScript-bron werkt. Krijg je `origin_mismatch`? Wacht dan even en probeer opnieuw.

## Deel 3 — LinkedIn-export aanvragen

1. Ga in LinkedIn naar **Ik → Instellingen en privacy → Gegevensprivacy → Een kopie van je gegevens ophalen**.
2. Kies de **eerste** optie: **Download larger data archive, including connections…** (bij "Want something in particular?" staat Connecties niet meer in de lijst). Klik **Request archive**.
3. Na een paar minuten tot een dag krijg je een mail (vaak eerst een snelle mail met een deel, later de rest). Download de zip en pak hem uit. Je hebt alleen het bestand `Connections.csv` nodig; zit het nog niet in de eerste zip, wacht dan op de tweede mail.

## Gebruiken

1. Open je GitHub Pages-adres in Chrome.
2. **Stap 1:** plak de Client-ID en klik **Inloggen en Google-contacten ophalen**.
   - Je krijgt de melding *"Google heeft deze app niet geverifieerd"*. Dat klopt, want het is je eigen app. Klik **Doorgaan**.
   - Vink **toegang tot je contacten** aan.
   - Klik daarna op **Back-up downloaden**. Daarmee heb je een kopie van alles zoals het was.
3. **Stap 2:** sleep `Connections.csv` in het vak.
4. **Stap 3:** loop de tabbladen door. Alleen wat aangevinkt is wordt doorgevoerd. Vooraf aangevinkt is alléén de **LinkedIn-link bij een zekere koppeling** (groen label "zekere koppeling"). Zeker betekent: het e-mailadres komt overeen, jij hebt de persoon zelf gekoppeld, of de naam klopt én het bedrijf klopt (volgens de werkgever of het e-maildomein in Google). Wil je dat niet, zet dan onderaan het vinkje **LinkedIn-link automatisch aanvinken** uit.
   - **Wijzigingen:** de persoon staat al in Google en LinkedIn heeft nieuwere gegevens (functie/werkgever, LinkedIn-link, e-mail). Vink de persoon aan (dan gaan alle velden mee) of vink losse velden aan.
   - **Koppelen aan bestaand contact…** (bij Nieuw en Twijfelgevallen): herkent de app iemand niet, maar staat hij wél in Google Contacts, klik dan op deze knop, zoek op naam, e-mail of bedrijf en kies het juiste contact. De persoon verhuist naar Wijzigingen. De app onthoudt de koppeling (en ziet hem ook via de LinkedIn-link als je die meeneemt). Verkeerd gekoppeld? Klik **Ontkoppelen**.
   - **Twijfelgevallen:** meerdere contacten met dezelfde naam, of een naam die er alleen op lijkt (bijvoorbeeld "Eva Mulder" en "Eva van Mulder"). Kies het juiste contact, kies **Nieuw contact aanmaken**, of laat het op overslaan staan.
   - **Nieuw:** de persoon staat nog niet in Google. Vink aan wie je wilt toevoegen. Nieuwe contacten krijgen het label **LinkedIn**, zodat je ze makkelijk terugvindt.
   - **Up-to-date:** hier hoeft niets te gebeuren.
   - **Genegeerd:** alles waarvan je hebt gezegd dat je het niet meer voorgesteld wilt krijgen (zie hieronder).
5. Klik **Doorvoeren**. Google staat ongeveer 60 wijzigingen per minuut toe, dus 200 wijzigingen duren zo'n 3–4 minuten. Laat het tabblad open tot het klaar is.

### "Niet meer voorstellen" en "Nooit toevoegen"

Een vinkje weghalen betekent: *nu niet*. Wil je een voorstel nooit meer zien, klik dan op:
- **Niet meer voorstellen** naast een voorgestelde wijziging, of bij een twijfelgeval;
- **Nooit toevoegen** bij iemand in het tabblad Nieuw.

De app onthoudt precies de waarde die je afwees. Wijs je "Manager @ Bol" af en wordt iemand later "Directeur @ Bol", dan krijg je dat nieuwe voorstel wél te zien. In het tabblad **Genegeerd** kun je een keuze met **Terugzetten** ongedaan maken.

Deze keuzes worden in je browser bewaard. Klik na een sessie op **Keuzes opslaan als bestand** en bewaar dat bestand (bijvoorbeeld in Google Drive). Heb je je browsergegevens gewist of gebruik je een andere computer, dan zet **Keuzes laden uit bestand** alles terug.

Draai het elk kwartaal opnieuw met een verse LinkedIn-export. Contacten die je al hebt bijgewerkt komen dan onder **Up-to-date**.

## Wat de app wel en niet doet

- De app **voegt alleen toe of werkt bij**. Hij verwijdert nooit contacten of gegevens. Een nieuwe functie vervangt wel de oude functie/werkgever bij dat contact. Andere velden, zoals telefoon, adres en notities, blijven onaangeraakt.
- De app **past nooit namen aan** in Google Contacts. Een naam als "Jeroen (vader Faas) Jansen" blijft dus precies zo staan.
- Namen vergelijken: de volgorde van de woorden en tussenvoegsels (de, van, der…) tellen niet mee, dus "Willem Vries de" op LinkedIn = "Willem de Vries" in Google.
- Koppelen gaat in deze volgorde: e-mailadres → LinkedIn-link → naam. Bij het vergelijken van namen maakt het niet uit of je hoofd- of kleine letters gebruikt (jeroen jansen = Jeroen Jansen), en ook accenten (é = e) tellen niet mee. Tekst tussen haakjes wordt genegeerd, net als titels zoals "MBA" of "Ir.". Twijfelt de app, dan beslist hij niets zelf; zo'n persoon komt onder Twijfelgevallen. Dat gebeurt bijvoorbeeld als twee LinkedIn-connecties dezelfde naam hebben.
- **De app onthoudt koppelingen via de LinkedIn-link.** Als je een wijziging doorvoert, zet de app de LinkedIn-link van die persoon in het Google-contact. Bij een volgende export herkent de app hem daaraan, hoe je hem in Google ook genoemd hebt. Dat onthouden gebeurt in Google zelf, dus het werkt ook op een andere computer. Laat het vinkje bij **LinkedIn-link** daarom aan staan.
- Je Client-ID wordt in je browser onthouden. Contactgegevens worden nergens opgeslagen: ververs je de pagina, dan zijn ze weg.
- De inlog geldt een uur. Daarna vraagt Google gewoon opnieuw om in te loggen.

## Problemen

| Melding | Oplossing |
|---|---|
| `origin_mismatch` / `redirect_uri_mismatch` | Controleer in Deel 2 stap 5 of de JavaScript-bron precies `https://<gebruikersnaam>.github.io` is. Wacht daarna 5 minuten. |
| `access_denied` / "app wordt getest" | Je Gmail-adres staat niet bij Testgebruikers (Deel 2 stap 4). |
| "Je hebt geen toegang tot je contacten gegeven" | Log opnieuw in en vink het vakje voor contacten aan. |
| `People API has not been used in project…` | De People API staat niet aan (Deel 2 stap 2), of er stond een ander project geselecteerd. |
| Er gebeurt niets bij inloggen | Zet de pop-upblokkering uit voor je github.io-adres. |
| Werkt niet als je `index.html` dubbelklikt | Dat klopt. Google-inlog werkt alleen vanaf het GitHub Pages-adres. |

---

## Contactenkaart (`kaart.html`)

Een tweede pagina die al je Google-contacten met een adres op een kaart zet. Zet `kaart.html` naast `index.html` in je repo; hij gebruikt dezelfde Google-inlog en er hoeft in Google Cloud niets extra ingesteld te worden. Je opent hem via de link bovenaan de app, of direct via `…/linkedin-google-contacts/kaart.html`.

- Klik **Inloggen en contacten op de kaart zetten**. De eerste keer duurt het even: elk adres wordt omgezet naar een plek op de kaart (Nederlandse adressen via PDOK van het Kadaster, buitenlandse via OpenStreetMap — die laatste max. 1 per seconde). Alleen de adrestekst gaat daarheen, geen namen. De uitkomsten worden in je browser onthouden, dus de volgende keer is de kaart direct klaar.
- Klik op een punt voor naam, bedrijf, adres, telefoon en e-mail, met links naar **Google Contacts**, **LinkedIn** en **Route**.
- Zoek op naam, bedrijf, straat of plaats, of filter op een **label** (bijvoorbeeld "Bussum").
- Adressen die niet gevonden werden staan onder de zoekbalk, met een link om ze in Google Contacts te verbeteren.
- De kaart leest alleen; hij verandert niets in je contacten.
