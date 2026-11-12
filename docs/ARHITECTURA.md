# Arhitectură și alternativa fără licențe

## De ce nu Power Apps

Prototipul Power Apps funcționează, dar conectorul personalizat către Kamstrup îl face aplicație
Premium, deci fiecare instalator ar avea nevoie de licență Power Apps plătită. Mutarea datelor în
SharePoint nu schimbă asta cât timp conectorul rămâne.

## Alternativa aleasă

Handoff-ul recomandă React + FastAPI + PostgreSQL/Azure SQL + Azure. Pentru un pilot cu trei
instalatori am păstrat ideea (PWA + API propriu), dar am simplificat-o ca să nu apară nici costuri
de licență, nici servicii cloud plătite:

| Strat | Recomandat în handoff | Ales aici | De ce |
|---|---|---|---|
| Interfață | React + TypeScript + Vite | HTML + JavaScript simplu | fără Node, fără pas de build; un singur ecran principal |
| API | FastAPI | FastAPI | la fel |
| Bază de date | PostgreSQL / Azure SQL | SQLite | un fișier, fără server; suficient pentru volumul pilotului |
| Hartă | MapLibre / Azure Maps | Leaflet + OpenStreetMap | fără cheie API, fără abonament |
| Găzduire | Azure App Service etc. | un singur proces / container | rulează pe orice VM sau server intern existent |
| Identitate | Entra ID | cuplare prin cod QR personal | Entra se poate adăuga ulterior, sau prin Cloudflare Access în fața aplicației |

Totul este un singur proces: API-ul servește și PWA-ul, pe un singur port.

Când pilotul crește, trecerea la PostgreSQL înseamnă înlocuirea `db.py`; trecerea la React nu
schimbă API-ul.

## Modul fără server

Kamstrup permite apelul direct din browser, așa că aceeași logică există și în `frontend/engine.js`
și rulează pe dispozitiv. `engine.js` răspunde la aceleași rute și cu același JSON ca serverul, deci
interfața nu face diferența. Registrul și sesiunile stau în IndexedDB pe telefon; nimic nu ajunge pe
un server. Se pierd doar lucrurile care cer un punct central: limita comună de interogare,
blocarea pe contor și istoricul comun.

Cele două implementări (Python și JavaScript) trebuie ținute sincronizate; testele acoperă aceleași
scenarii în ambele.

## Licențe

| Componentă | Licență | Cost |
|---|---|---|
| Python | PSF | 0 |
| FastAPI | MIT | 0 |
| Uvicorn, httpx | BSD-3 | 0 |
| SQLite | domeniu public | 0 |
| Leaflet 1.9.4 (inclus în `frontend/vendor`) | BSD-2 | 0 |
| jsQR 1.4.0 (citire QR unde browserul nu are cititor propriu) | Apache-2.0 | 0 |
| segno (generarea codului QR de cuplare) | BSD-3 | 0 |
| Date și plăci OpenStreetMap | ODbL; politica de utilizare a serverului de plăci | 0 la trafic mic |
| Docker Engine (opțional) | Apache-2.0 | 0 |
| Caddy + Let's Encrypt (HTTPS, opțional) | Apache-2.0 | 0 |

Trei lucruri de știut:

- **Docker Desktop** (aplicația pentru Windows/Mac) cere abonament plătit în companiile mari.
  Docker Engine pe Linux este gratuit, iar aplicația rulează și fără Docker, direct cu Python.
- **Plăcile OpenStreetMap** sunt gratuite, dar serverul public nu acceptă trafic intens. Trei
  instalatori sunt mult sub limită; la extindere se poate găzdui un server propriu de plăci.
- **Găzduirea** nu este licență, dar cere o mașină: un VM sau server intern existent este suficient.
  Înregistrarea unei aplicații în Entra ID, pentru autentificarea ulterioară, se face în tenantul
  existent; de confirmat cu IT că nu implică un plan suplimentar.

## Fluxul datelor

```
Telefon (PWA) ──HTTPS──> API LinkIQ ──GET, max. 1 la 5 s per contor──> Kamstrup Device Monitor
                             │
                             └── SQLite: sesiuni, poziții, toate observațiile, decizie
```

Stări sesiune: `READY → (CALL) → WAIT_RF → MEASURED → (poziție nouă) → WAIT_RF → … → COMPLETE`.

Fiecare observație primită este clasificată o singură dată, după amprentă:

- `baseline` – exista deja când s-a confirmat CALL; nu se folosește niciodată ca măsurătoare
- `fresh` – nouă și generată după ce antena a fost declarată stabilă; se atașează poziției curente
- `stale` – nouă, dar cu timestamp mai vechi decât momentul poziționării; se păstrează, nu se punctează

## API

```
POST /api/sessions                         {meterSerial, technician, gps?}
POST /api/sessions/{id}/call-confirmed     {phase: initial | final}
POST /api/sessions/{id}/position-marked    {phase: coarse | fine, step, headingDeg?}
POST /api/sessions/{id}/skip
GET  /api/sessions/{id}/poll               -> PollResponse (Anexa A) + rezumat
GET  /api/sessions/{id}                    rezumat (pentru reluare)
POST /api/sessions/{id}/complete           {outcome?, note?}
GET  /api/sessions/{id}/export
GET  /api/sites?lat=&lon=
GET  /api/concentrators/{serial}
GET  /api/export/observations.csv
GET  /api/me                               numele asociat codului de cuplare
GET  /api/config, /api/health
```

Față de propunerea din handoff: `finish-coarse` și `start-fine` nu există ca apeluri separate.
Câștigătorul se calculează la fiecare răspuns, iar reglajul fin începe cu `position-marked`
(`phase: fine`). S-a adăugat `skip`.

## Model de amenințări (pilot)

| Risc | Măsură | Rămas de făcut |
|---|---|---|
| Acces neautorizat la API și la registru | cod personal per telefon, păstrat doar ca amprentă, retractabil; transmis în fragmentul URL, care nu ajunge la server | Entra ID |
| Date reale publicate odată cu codul | exemplele sunt inventate; CSV-urile reale și codurile QR sunt în `.gitignore` | – |
| Interogare excesivă a Kamstrup | limită centrală per contor, cache între apeluri | limită și per utilizator |
| Doi instalatori pe același contor | blocare cu heartbeat (120 s) | – |
| Serie de contor folosită pentru a altera URL-ul către Kamstrup | doar 4–20 litere/cifre acceptate | – |
| Date de la Kamstrup afișate în pagină | inserate doar ca text, niciodată ca HTML | – |
| Pierderea datelor | observațiile se scriu imediat; SQLite în mod WAL | backup programat al fișierului |
| Endpoint Kamstrup neautentificat, fără acord de producție | sursa este izolată într-un adaptor înlocuibil | acordul Kamstrup |
| Trafic necriptat | – | HTTPS obligatoriu la instalare |
