# LinkIQ Field Assistant

**Dansk** · [English](README.en.md) · [Română](docs/ro/README.md)

LinkIQ er en webapp, der kan installeres på telefonen (PWA). Den hjælper montøren med at rette
antennen ind på en Kamstrup-varmemåler ud fra rigtige radiomålinger. Appen erstatter
Power Apps-prototypen og kræver ingen betalte licenser. Åben kildekode, MIT-licens.

Status: **v0.21**. Hele forløbet kører på simulatoren og på opfangede svar fra Kamstrup i browseren.
En hurtig bekræftelse er gennemført på en rigtig måler. En fuld rotation på en rigtig måler mangler.

Kort vejledning til montøren: [docs/VEJLEDNING_DA.md](docs/VEJLEDNING_DA.md).

## To driftsformer

| | Uden server (standard) | Med central server (valgfri) |
|---|---|---|
| Hvad kører | kun mappen `frontend/` som statiske sider | `backend/` + `frontend/` |
| Hvem kalder Kamstrup | telefonens browser, direkte | serveren |
| Register og sessioner | på enheden; eksporteres som CSV | i serverens database |
| Grænse på 5 s pr. måler | pr. enhed | centralt, for alle telefoner |
| Lås, når to montører tester samme måler | nej | ja |
| Parring af telefonen med kode | ikke nødvendig | ja |

Siden vælger selv: svarer der ikke en LinkIQ-server på dens adresse, kører den uden server.
Kamstrup tillader kaldet direkte fra browseren (kontrolleret 12.11.2026).

## Start uden server

**På en bærbar, til en prøve:** dobbeltklik på `frontend/index.html`. Målingen virker. Kamera,
GPS og installation på startskærmen kræver HTTPS og virker derfor ikke fra en fil.

**På en telefon, til en prøve uden hosting:** kopiér én fil, `dist/linkiq.html`, til telefonen,
og åbn den i Chrome. Alt er indbygget. (Mappen `frontend/` virker ikke kopieret til telefonen,
fordi telefonen ikke lader siden indlæse filerne ved siden af.) Filen bygges med
`python tools/build_single.py`. Åbnet på denne måde læses målernummeret ved at fotografere
QR-koden, og positionen vælges på kortet. Live-kamera og GPS kræver en HTTPS-adresse.
Data bliver muligvis ikke gemt mellem åbningerne.

**På Android, fuld funktion uden hosting:** Chrome betragter `http://localhost` som en sikker
adresse. En lille filserver på telefonen giver derfor GPS, live-kamera, installation og gemte data.
Se [docs/ANDROID.md](docs/ANDROID.md).

**På telefonerne i drift:** appen udgives på Azure Static Web Apps (Free-plan), kun for inviterede
brugere. Montøren åbner adressen, logger ind med sin arbejdskonto og vælger *Føj til startskærm*.
Se *Hosting og udgivelse* nedenfor.

### Registret uden import på hver telefon

Appen leder efter registret i denne rækkefølge:

1. **Indbygget i appfilen.** `python tools/build_single.py --sites linkiq_sites.csv --concentrators linkiq_koncentratorer.csv --out ../linkiq-med-register.html`
   laver én fil med appen og jeres register. Montørerne skal ikke importere noget, og filen virker
   også åbnet direkte fra telefonens hukommelse. Den indeholder de rigtige placeringer:
   **den må ikke udgives**.
2. **Ved siden af appen på serveren.** Ligger `linkiq_sites.csv` og `linkiq_koncentratorer.csv` i
   samme mappe som `index.html`, indlæses de automatisk ved start. Egnet til intern hosting med
   begrænset adgang, ikke til en offentlig adresse.
3. **Importeret manuelt**, én gang, fra kortet nedenfor: fra de to CSV-filer eller fra en QR-kode, som en kollega viser
   på skærmen eller sender som billede (*Lav en QR-kode af registret til kolleger*). QR-vejen bruges, hvor
   arbejdstelefonen ikke må gemme filer fra Teams eller mail. Bliver på enheden indtil næste import.

Et nyere register (indbygget eller fra mappen) erstatter det gamle én gang. En senere manuel import
bliver ikke overskrevet.

I kortet *Data på denne enhed*:

- **Indlæs sites / koncentratorer (CSV)**: registret bliver kun på telefonen. Kolonnerne
  `Breddegrad` / `Længdegrad`, decimalkomma og filer gemt fra Excel accepteres. Uden register
  behandles alle modtagere, der hører måleren, som vores egne.
- **Eksportér målingerne (CSV)**: alle sessioner på enheden, til analyse.
- **Demotilstand**: simulator, til oplæring uden måler.

Test: `node --test tests-js/engine.test.js tests-js/lcd.test.js` (motoren og aflæsningen af displayet)

## Start med central server

**Windows:** dobbeltklik på `start.bat` (rigtigt Kamstrup-API) eller `start.bat sim`. Kræver Python.

**Manuelt, på ethvert system:**

```bash
cd backend
pip install -r requirements.txt
python scripts/import_registry.py --sites data/sites.sample.csv --concentrators data/concentrators.sample.csv
uvicorn app.main:app --port 8000
```

Test: `pip install -r requirements-dev.txt && pytest`. Med Docker: `docker compose up --build`.

## Hvad er implementeret

| Krav fra overdragelsesdokumentet | Status |
|---|---|
| Central proxy til Kamstrup; telefonen kalder ikke Kamstrup direkte (servertilstand) | ja |
| Grænse på 5 s pr. måler, uanset hvor mange telefoner der spørger | ja |
| Ny observation = ukendt fingeraftryk `serial\|timestamp\|rssi`; baseline ved CALL | ja |
| Observationer ældre end positioneringen tilskrives ikke den nye position; manglende tidsstempel håndteres eksplicit | ja |
| Grov rotation i 4 felter (antallet kan ændres), advarsel efter 60 s uden at fejle, spring position over | ja |
| Antennetype vælges før CALL; intern antenne og „Én position“ (fastskruet antenne, ingeniørens sted) = ét CALL, én måling, vist som én cirkel | ja |
| Felter kan fravælges før start (tryk på feltet) og springes over undervejs | ja |
| Første måling slutter, så snart koncentratorerne, der plejer at høre måleren, har svaret; „Videre med det, der er kommet“ | ja |
| En position er målt, når referencemodtageren (den stærkeste) har svaret, ikke ved første svage måling; sene målinger tilskrives den position, de blev taget i | ja |
| Alle egne modtagere gemmes, også de svage; fremmede kun i loggen | ja |
| Lagkage med farvede felter (blå / gul / grøn / grå / lysegrå) | ja |
| Hurtig bekræftelse ved stærkt startsignal | ja |
| Live-finjustering i det vindende felt: referencemodtagerens signal på skærmen uden tryk; opdateres, når modtageren melder, hvert 20.–30. sekund | ja |
| Afsluttende CALL og sammenligning med den bedste måling | ja |
| Redundans: reserve på et andet site foretrækkes frem for samme site; anbefales ikke, hvis den svækker hovedforbindelsen | ja (visning; ingen særskilt rotation) |
| Sessionslås pr. måler med heartbeat og genoptagelse af samme montør (servertilstand) | ja |
| Modtagerliste, kort med afstand og retning | ja |
| Import af register (sites / koncentratorer) fra CSV | ja |
| Eksport til Network Intelligence (`/api/export/observations.csv`) | ja |
| PWA: manifest, service worker, installation på startskærmen | ja |
| Parring af telefon med personlig QR-kode, tilbagekaldelse af adgang (servertilstand) | ja |
| Scanning af målernummer fra QR-kode | ja (reglen for udtræk skal bekræftes på en rigtig måler) |
| QR-kode fra et foto og valg af position på kortet, når siden ikke kører via HTTPS | ja |
| Brugerflade på dansk (standard) og rumænsk, skift i toppen | ja |
| Rapport ved afslutning: billede `<målernummer>.png` med rotation, finjustering, slutbekræftelse og modtagere | ja |
| Foto af antennen med resultatet skrevet på: `<målernummer>_antenne.jpg` | ja |
| Kort med linjer måler–site, signal og afstand; samme kort i rapporten | ja |
| Rapport også som PDF (`<målernummer>.pdf`) med antennefotoet og installationsbillederne på de følgende sider | ja |
| Billeder af installationen ved montage og idriftsættelse (op til 6, med målernummer og tidspunkt), ved hver installation | ja |
| Adressesøgning på kortet (OpenStreetMap, kun på installatørens tryk) | ja |
| QR-kode til kolleger, der åbner trinene til bogmærket li (siden hedder allerede li) | ja |
| Rapporter fra mappen eller fra filer kan føjes til VVS-listen, så en glemt dag ikke går tabt | ja |
| Kontrol af en måler uden session og uden CALL: hvem hører den nu, og siden hvornår (`<målernummer>_status.pdf`) | ja, kun uden server |
| Statuskontrol: hver koncentrator én gang; seneste kontakt inden for den seneste time (≤ 75 min), lejlighedsvis (≤ 8 t) eller ældre (tæller ikke); dom om timedata og redundans; grænser for signal og kontakt skrevet i rapporten | ja |
| Mappe valgt af montøren til rapporter (oprettes som `LinkIQ-rapporter`) med liste over gemte rapporter; uden browserunderstøttelse bruges almindelig download | ja |
| Hver målers position huskes på enheden og genbruges ved kontrol uden CALL | ja |
| Monteringsdata obligatoriske ved gem, valgt med store knapper uden standardværdier: målerens niveau, intern/ekstern antenne, antennens placering; vises i rapport, på foto og i CSV-eksport | ja |
| Målerens position kan angives eller rettes på kortet efter målingen, også ved kontrol uden CALL | ja |
| Feedback fra appen via telefonens deling (Teams, mail) eller udklipsholder | ja |
| Åbn målerens sag i VVS-dialog (knap + bogmærket `li`) | ja |
| Målerstande i rapporten (valgfrit): E1, V1, driftstimer, E8, E9 og andre registre aflæses med kameraet fra målerens display, kan rettes, og billedet af displayet står ved værdien | ja (testet på billeder af en MULTICAL 603, endnu ikke i felten) |
| Aflæsning af det trykte målernummer med kameraet (OCR) | **nej** |
| Login med Microsoft Entra ID i appen | **nej**: adgangen styres af hostingen (Azure) eller af parringskode (server) |
| Offline-kø til handlinger | **nej**: sessionen genoptages efter tabt forbindelse, men handlinger sættes ikke i kø |
| Kompas til vejledning | delvist: telefonens retning gemmes, hvis browseren giver den, men bruges ikke til vejledning |

## Central server: test mod det rigtige Kamstrup-API

Svarformatet blev kontrolleret 12.11.2026: modtagerens nummer ligger i feltet `SerialNumber` i hvert
element af `Links[]`, og adapteren læser det korrekt.

På en bærbar med internet:

```bash
cd backend
python scripts/check_kamstrup.py <målernummer>          # én forespørgsel: hvad adapteren ser
python scripts/import_registry.py --sites <sites.csv> --concentrators <koncentratorer.csv>
python scripts/pairing.py add --name Ana --url http://localhost:8000
KAMSTRUP_MODE=live uvicorn app.main:app --port 8000      # Windows: set KAMSTRUP_MODE=live
```

Åbn parringslinket fra `pairing.py`, indtast nummeret på måleren på skrivebordet, tryk CALL på
måleren, og bekræft. Mærket SIMULATOR forsvinder i live-tilstand.

Test på telefon kræver HTTPS (ellers er kamera og GPS blokeret). Hurtigst:
`cloudflared tunnel --url http://localhost:8000` giver en midlertidig HTTPS-adresse til den bærbare.
Lav parringslinket igen med `--url` sat til den adresse.

## Central server: parring af telefoner

Kildekoden indeholder ingen data. Registret (sites, koordinater, koncentratorer) ligger kun i jeres
instans' database og sendes kun til parrede telefoner. En anden organisation starter sin egen
instans med sit eget register.

- `python scripts/pairing.py add --name Ana --url https://jeres-adresse` laver en personlig kode
  og en fil `pair-Ana.svg` med QR-koden.
- Montøren scanner QR-koden én gang; appen åbner allerede parret i hans navn.
- `pairing.py revoke --name Ana` fjerner adgangen med det samme (tabt telefon, kollega stoppet).
- Databasen gemmer kun kodens fingeraftryk, så linket kan ikke vises igen.

Med `KAMSTRUP_MODE=live` er parring påkrævet som standard: uden kode svarer API'et 401.

## Scanning af målernummeret

Knappen *Scan* ved målernummerfeltet åbner kameraet og læser QR-koden. Indeholder koden kun
nummeret, udfyldes feltet direkte. Indeholder den flere tal, viser appen dem, og montøren vælger det
rigtige. Det præcise indhold af Kamstrups QR-kode kendes endnu ikke; efter en rigtig scanning kan
reglen fastlægges, så nummeret vælges automatisk.

Aflæsning af det trykte nummer (OCR) er ikke implementeret.

## Målerstande i rapporten (valgfrit)

Under *Rapport* står de faste felter **E1, V1, driftstimer, E8 og E9**. Andre registre (fx V2,
infokode, flow, temperaturer) vælges under *Andre registre*: sæt flueben ved alle dem, du vil have
med, på én gang. Inden den første rapport gemmes, spørger
appen én gang, om målerstandene skal med. Svaret er frivilligt.

Sådan læses en værdi:

1. Vis registret på måleren (fx E1), og tryk på kameraet ved E1 i appen.
2. Hold hele displayet inde i rammen. Når det samme tal er læst flere gange i træk, vibrerer
   telefonen, og værdien står i feltet sammen med et lille billede af displayet.
3. Kontrollér tallet mod displayet. Ret det i feltet, hvis det er forkert.

Aflæsningen sker på telefonen, uden internet og uden eksterne tjenester (`frontend/lcd.js`). Den er
lavet til 7-segment-displayet på MULTICAL 603: lokal tærskel mod skygge og genskin, retter en skæv
telefon op, finder decimalpunktet og stemmer over flere billeder. Hovedregistrene viser 8 cifre; et
andet antal accepteres kun, når det er meget stabilt. Kan intet læses, gemmes billedet, og montøren
skriver værdien selv. Knapperne *Lygte* og *Tag billede* hjælper i mørke rum og på svage kameraer.

Koncentratorer, der sidst hørte måleren for mere end 9 timer siden, kommer ikke med i rapporten
(hverken i listen eller på kortet). De kan ikke bære timedata, og de kan stamme fra, at måleren var
tændt under transporten. Rapporten skriver, hvor mange der er udeladt.

I rapporten står hver værdi med enhed, kilden (*aflæst med kameraet*, *rettet af montøren* med den
oprindelige aflæsning, eller *indtastet af montøren*), tidspunktet og billedet af displayet.

## Åbn sagen i VVS-dialog (KMD)

Rapporterne uploades manuelt i VVS-dialog. LinkIQ kan ikke handle dér (et andet website, montørens
eget login), så appen gør kun vejen kortere:

- knappen *Åbn VVS-dialog* ved rapporten kopierer målernummeret og åbner VVS-dialog med nummeret i
  adressen (`#linkiq=…`) og som fanens navn;
- bogmærket `li`, oprettet én gang i Chrome fra appen, startes af montøren fra adresselinjen på
  VVS-dialog-siden. Det søger på måleren, vælger den sag, der ikke er *Afsluttet* eller *Lukket*
  (er der flere, vises de), og åbner den. Det uploader, ændrer og sletter ikke noget.

Bogmærkets kode: `tools/vvs/bookmark.src.js`; `python tools/build_vvs.py` pakker den ind i
`frontend/vvs.js`. På Android starter bogmærket kun fra adresselinjen, og den installerede app åbner
som regel VVS-dialog i et vindue uden adresselinje (*⋮ → Åbn i Chrome*).

## Central server: hosting

| Mulighed | Egnet? | Bemærkninger |
|---|---|---|
| Server / VM fra IT | **ja, anbefalet** | kører præcis det, der ligger her; registret bliver i jeres infrastruktur |
| Intern computer + Cloudflare Tunnel | ja | HTTPS uden åbne porte i firewallen; Cloudflare Access kan kræve Microsoft-login |
| Cloudflare Workers / Pages | ikke direkte | kører ikke Python-serveren; den skulle omskrives til JavaScript |
| Microsoft 365 / SharePoint | nej | kan ikke køre en server og viser ikke HTML-apps; kun egnet til registrets filer |
| React Native | ikke hosting | en senere app ville bruge den samme server |

Serveren skal have adgang til internettet til `check.kamstrup.com` og et vedvarende drev til
SQLite-filen.

## Hosting og udgivelse

Mens appen udvikles, ligger arbejdskopien på GitHub. Pipelinen i Azure DevOps
(*Målerservice-Udviklingsprojekt*) starter ved hver ændring på `main` på GitHub: den kører
motortestene, kopierer `main` til Azure Repos-depotet `linkiq` og udgiver `frontend/` på
Azure Static Web Apps. Montørerne bruger kun adressen i Azure.

- Kopieringen til Azure Repos kræver, at *… Build Service* har rettigheden *Contribute* på depotet
  `linkiq`.
- Udgivelsen kræver to variabler i pipelinen: `deployment_token` (hemmelig; Static Web App →
  Overview → Manage deployment token) og `publish_enabled` = `true`. Indtil da tester og kopierer
  pipelinen kun.

Adgangen er fastlagt i `frontend/staticwebapp.config.json`: kun inviterede brugere med rollen
`montor` kommer ind (Static Web App → Role management → Invite, provider Microsoft Entra ID).
Login med GitHub er blokeret. Invitation af en kollega: arbejdsmail, rollen `montor`, linket sendes
til kollegaen.

Det rigtige register (sites og koncentratorer) lægges ikke i depotet uden teamets accept, heller ikke
selv om depotet er privat.

## Før pilotdrift

1. **Det rigtige register**: eksportér de to lister som CSV, og importér dem. `Breddegrad` /
   `Længdegrad` og decimalkomma genkendes; koncentratorer uden sikkert site bliver `REVIEW` /
   `MISSING_LOCATION`. Så længe registret er tomt, behandles alle modtagere som egne.
   De rigtige CSV-filer er udelukket fra git via `.gitignore`.
2. **HTTPS** på den endelige adresse.
3. **Grænseværdier**: værdierne i `.env.example` (−80 / −95 / −110 dBm, 6 dB) er foreløbige.
4. **Kamstrup**: betingelserne for at bruge endpointet i drift skal bekræftes.

## Struktur

```
frontend/engine.js        al målelogik på enheden (drift uden server)
frontend/app.js           brugerfladen; den samme i begge driftsformer
frontend/i18n.js          de danske tekster (kildeteksterne er på rumænsk)
frontend/vvs.js           bogmærket li til VVS-dialog (bygges fra tools/vvs/)
frontend/lcd.js           aflæsning af målerens 7-segment-display med kameraet
frontend/                 PWA (HTML + CSS + almindelig JavaScript, intet byggetrin)
tests-js/                 21 test af engine.js, 17 af lcd.js (billeder af displayet)
backend/app/              valgfri central server: samme regler i Python
backend/scripts/          import af register, parringskoder, kontrol af Kamstrup
backend/tests/            18 test
docs/VEJLEDNING_DA.md     kort vejledning til montøren
docs/ARKITEKTUR.md        valgt løsning, licenser, API, trusselsmodel
docs/ANDROID.md           fuld funktion på Android uden hosting
docs/ro/                  de oprindelige rumænske dokumenter
azure-pipelines.yml       test, kopi til Azure Repos og udgivelse på Azure
```
