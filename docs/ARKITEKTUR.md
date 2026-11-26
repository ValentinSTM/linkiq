# Arkitektur og løsningen uden licenser

**Dansk** · [English](en/ARCHITECTURE.md) · [Română](ro/ARHITECTURA.md)

## Hvorfor ikke Power Apps

Power Apps-prototypen virker, men den brugerdefinerede connector til Kamstrup gør den til en
Premium-app. Hver montør skulle derfor have en betalt Power Apps-licens. At flytte data til
SharePoint ændrer ikke på det, så længe connectoren er der.

## Den valgte løsning

Overdragelsesdokumentet anbefaler React + FastAPI + PostgreSQL/Azure SQL + Azure. Til en pilot med
få montører har vi beholdt ideen (PWA + eget API), men forenklet den, så der hverken kommer
licensomkostninger eller betalte cloudtjenester:

| Lag | Anbefalet i overdragelsen | Valgt her | Hvorfor |
|---|---|---|---|
| Brugerflade | React + TypeScript + Vite | HTML + almindelig JavaScript | ingen Node, intet byggetrin; én hovedskærm |
| API | FastAPI | FastAPI | det samme |
| Database | PostgreSQL / Azure SQL | SQLite | én fil, ingen databaseserver; nok til pilotens omfang |
| Kort | MapLibre / Azure Maps | Leaflet + OpenStreetMap | ingen API-nøgle, intet abonnement |
| Hosting | Azure App Service osv. | Azure Static Web Apps (Free) uden server; én proces / container med server | ingen omkostninger; kører også på enhver eksisterende VM |
| Identitet | Entra ID | Entra ID via hostingen (inviterede brugere); parringskode med server | ingen kode til login i selve appen |

Med server er alt én proces: API'et leverer også PWA'en på én port.

Vokser piloten, betyder skift til PostgreSQL, at `db.py` udskiftes. Skift til React ændrer ikke API'et.

## Drift uden server

Kamstrup tillader kaldet direkte fra browseren, så den samme logik findes også i
`frontend/engine.js` og kører på enheden. `engine.js` svarer på de samme ruter og med den samme JSON
som serveren, så brugerfladen mærker ingen forskel. Register og sessioner ligger i IndexedDB på
telefonen; intet sendes til en server. Det eneste, man mister, er det, der kræver et centralt punkt:
den fælles grænse for forespørgsler, låsen pr. måler og den fælles historik.

De to implementeringer (Python og JavaScript) skal holdes i takt; testene dækker de samme scenarier
i begge.

## Licenser

| Komponent | Licens | Pris |
|---|---|---|
| Python | PSF | 0 |
| FastAPI | MIT | 0 |
| Uvicorn, httpx | BSD-3 | 0 |
| SQLite | public domain | 0 |
| Leaflet 1.9.4 (i `frontend/vendor`) | BSD-2 | 0 |
| jsQR 1.4.0 (QR-læsning, hvor browseren ikke selv kan) | Apache-2.0 | 0 |
| segno (QR-kode til parring) | BSD-3 | 0 |
| Aflæsning af målerens display (`frontend/lcd.js`, eget arbejde) | MIT (projektets) | 0 |
| qrcode-generator 1.4.4 (QR-kode med registret, i `frontend/vendor`) | MIT | 0 |
| OpenStreetMap-data og -kortfliser | ODbL; brugsregler for fliseserveren | 0 ved lav trafik |
| Docker Engine (valgfri) | Apache-2.0 | 0 |
| Caddy + Let's Encrypt (HTTPS, valgfri) | Apache-2.0 | 0 |
| Azure Static Web Apps, Free-plan | tjeneste | 0 |

Tre ting, man skal vide:

- **Docker Desktop** (programmet til Windows/Mac) kræver betalt abonnement i store virksomheder.
  Docker Engine på Linux er gratis, og appen kører også uden Docker, direkte med Python.
- **OpenStreetMap-fliserne** er gratis, men den offentlige server accepterer ikke tung trafik. Nogle
  få montører er langt under grænsen; ved udvidelse kan man hoste sin egen fliseserver.
- **Hosting** er ikke en licens, men kræver en maskine eller en tjeneste. Azure Static Web Apps på
  Free-planen kræver en Azure-subscription i virksomheden; selve planen koster intet.

## Aflæsning af målerens display

Målerstandene læses med en lille, egen 7-segment-læser (`frontend/lcd.js`) i stedet for en generel
OCR. Generel OCR (fx Tesseract.js) kræver modelfiler på flere MB, læser segmenttal dårligt og er
langsom på billige telefoner; OCR i skyen sender billeder ud af huset. Læseren her kender displayets
form: den finder rækken med de store cifre, læser hvert ciffers 7 segmenter, finder decimalpunktet,
retter en skæv telefon op og bruger lokal tærskel mod skygge og genskin. Den kører på ca. 7 ms pr.
billede, helt offline, og flere billeder i træk skal give det samme tal, før værdien bruges.
Montøren kontrollerer altid tallet, og billedet af displayet gemmes i rapporten som dokumentation.

## Dataflow

```
Telefon (PWA) ──HTTPS──> LinkIQ-API ──GET, højst 1 pr. 5 s pr. måler──> Kamstrup Device Monitor
                             │
                             └── SQLite: sessioner, positioner, alle observationer, beslutning
```

Uden server går pilen direkte fra telefonen til Kamstrup, og SQLite erstattes af IndexedDB på telefonen.

Sessionstilstande: `READY → (CALL) → WAIT_RF → MEASURED → (ny position) → WAIT_RF → … → COMPLETE`.

Hver modtaget observation klassificeres én gang ud fra sit fingeraftryk:

- `baseline`: fandtes allerede, da CALL blev bekræftet; bruges aldrig som måling
- `fresh`: ny og opstået, efter at antennen blev meldt stille; knyttes til den aktuelle position
- `stale`: ny, men med et tidsstempel ældre end positioneringen; gemmes, men tæller ikke

## API

```
POST /api/sessions                         {meterSerial, technician, gps?}
POST /api/sessions/{id}/call-confirmed     {phase: initial | final}
POST /api/sessions/{id}/position-marked    {phase: coarse | fine | live, step, headingDeg?}
POST /api/sessions/{id}/skip
GET  /api/sessions/{id}/poll               -> PollResponse (bilag A) + resumé
GET  /api/sessions/{id}                    resumé (til genoptagelse)
POST /api/sessions/{id}/complete           {outcome?, note?, install?}
GET  /api/sessions/{id}/export
GET  /api/sites?lat=&lon=
GET  /api/concentrators/{serial}
GET  /api/export/observations.csv
GET  /api/me                               navnet knyttet til parringskoden
GET  /api/config, /api/health
POST /api/check                            kontrol uden CALL (kun uden server)
```

I forhold til forslaget i overdragelsen findes `finish-coarse` og `start-fine` ikke som separate
kald. Vinderen beregnes ved hvert svar, og finjusteringen starter med `position-marked`
(`phase: fine` eller `live`). `skip` er tilføjet.

## Trusselsmodel (pilot)

| Risiko | Foranstaltning | Mangler |
|---|---|---|
| Uautoriseret adgang til app og register | uden server: kun inviterede brugere med Entra-login (Azure Static Web Apps); med server: personlig kode pr. telefon, gemt som fingeraftryk, kan tilbagekaldes, sendt i URL-fragmentet, som ikke når serveren | – |
| Rigtige data udgivet sammen med koden | eksemplerne er opdigtede; de rigtige CSV-filer og QR-koder er i `.gitignore` | – |
| For mange forespørgsler til Kamstrup | grænse pr. måler, cache mellem kald | grænse pr. bruger |
| To montører på samme måler | lås med heartbeat (120 s), kun med server | – |
| Målernummer brugt til at ændre URL'en til Kamstrup | kun 4–20 bogstaver/cifre accepteres | – |
| Data fra Kamstrup vist på siden | indsættes kun som tekst, aldrig som HTML | – |
| Tab af data | observationer skrives med det samme; SQLite i WAL-tilstand | planlagt backup af filen |
| Kamstrup-endpoint uden godkendelse og uden aftale om drift | kilden er isoleret i en udskiftelig adapter | aftale med Kamstrup |
| Ukrypteret trafik | HTTPS på hostingen | – |
| En tredjeparts koncentrator får en dårlig installation til at se god ud | kun koncentratorer i registret, aktive og med ejer Kredsløb tæller; uden register ingen måling (fail closed) | ejerkolonne i registereksporten |
| Kode plantet i VVS-dialog via li | li tager kun imod arbejde fra LinkIQ-adresser og sender kun resultater dertil | signeret li-kode (nyt bogmærke) |

Den fulde gennemgang og status: [SIKKERHED.md](SIKKERHED.md).
