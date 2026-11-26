# Architecture and the licence-free solution

[Dansk](../ARKITEKTUR.md) · **English**

## Why not Power Apps

The Power Apps prototype works, but the custom connector to Kamstrup makes it a Premium app, so
every installer would need a paid Power Apps licence. Moving the data to SharePoint does not change
that while the connector remains.

## The chosen solution

The handoff recommends React + FastAPI + PostgreSQL/Azure SQL + Azure. For a pilot with a few
installers we kept the idea (PWA + own API) but simplified it, so there are neither licence costs
nor paid cloud services:

| Layer | Recommended in the handoff | Chosen here | Why |
|---|---|---|---|
| User interface | React + TypeScript + Vite | HTML + plain JavaScript | no Node, no build step; one main screen |
| API | FastAPI | FastAPI | the same |
| Database | PostgreSQL / Azure SQL | SQLite | one file, no database server; enough for the pilot |
| Map | MapLibre / Azure Maps | Leaflet + OpenStreetMap | no API key, no subscription |
| Hosting | Azure App Service etc. | Azure Static Web Apps (Free) without a server; one process / container with a server | no cost; also runs on any existing VM |
| Identity | Entra ID | Entra ID through the hosting (invited users); pairing code with a server | no sign-in code inside the app |

With a server, everything is one process: the API also serves the PWA, on one port.

If the pilot grows, moving to PostgreSQL means replacing `db.py`. Moving to React does not change the API.

## Running without a server

Kamstrup allows the call directly from the browser, so the same logic also exists in
`frontend/engine.js` and runs on the device. `engine.js` answers the same routes with the same JSON
as the server, so the user interface cannot tell the difference. Registry and sessions are kept in
IndexedDB on the phone; nothing goes to a server. Only what needs a central point is lost: the
shared request limit, the lock per meter and the shared history.

The two implementations (Python and JavaScript) must be kept in step; the tests cover the same
scenarios in both.

## Licences

| Component | Licence | Cost |
|---|---|---|
| Python | PSF | 0 |
| FastAPI | MIT | 0 |
| Uvicorn, httpx | BSD-3 | 0 |
| SQLite | public domain | 0 |
| Leaflet 1.9.4 (in `frontend/vendor`) | BSD-2 | 0 |
| jsQR 1.4.0 (QR reading where the browser has no reader) | Apache-2.0 | 0 |
| segno (QR code for pairing) | BSD-3 | 0 |
| Meter display reader (`frontend/lcd.js`, own work) | MIT (the project's) | 0 |
| qrcode-generator 1.4.4 (QR code with the registry, in `frontend/vendor`) | MIT | 0 |
| OpenStreetMap data and tiles | ODbL; tile server usage policy | 0 at low traffic |
| Docker Engine (optional) | Apache-2.0 | 0 |
| Caddy + Let's Encrypt (HTTPS, optional) | Apache-2.0 | 0 |
| Azure Static Web Apps, Free plan | service | 0 |

Three things to know:

- **Docker Desktop** (the Windows/Mac application) needs a paid subscription in large companies.
  Docker Engine on Linux is free, and the app also runs without Docker, directly with Python.
- **OpenStreetMap tiles** are free, but the public server does not accept heavy traffic. A few
  installers are far below the limit; at a larger scale you can host your own tile server.
- **Hosting** is not a licence, but it needs a machine or a service. Azure Static Web Apps on the
  Free plan needs an Azure subscription in the company; the plan itself costs nothing.

## Reading the meter display

Meter readings use a small 7-segment reader of our own (`frontend/lcd.js`) instead of general OCR.
General OCR (e.g. Tesseract.js) needs model files of several MB, reads segment digits poorly and is
slow on cheap phones; cloud OCR sends pictures out of the company. This reader knows the display:
it finds the row of large digits, reads each digit's 7 segments, finds the decimal point,
straightens a tilted phone and uses a local threshold against shadow and glare. It takes about 7 ms
per frame, fully offline, and several frames in a row must give the same number before the value is
used. The installer always checks the number, and the picture of the display is kept in the report.

## Data flow

```
Phone (PWA) ──HTTPS──> LinkIQ API ──GET, at most 1 per 5 s per meter──> Kamstrup Device Monitor
                           │
                           └── SQLite: sessions, positions, all observations, decision
```

Without a server, the arrow goes straight from the phone to Kamstrup, and SQLite is replaced by
IndexedDB on the phone.

Session states: `READY → (CALL) → WAIT_RF → MEASURED → (new position) → WAIT_RF → … → COMPLETE`.

Every observation received is classified once, by its fingerprint:

- `baseline`: already there when CALL was confirmed; never used as a measurement
- `fresh`: new and produced after the antenna was declared still; attached to the current position
- `stale`: new, but with a timestamp older than the positioning; kept, not scored

## API

```
POST /api/sessions                         {meterSerial, technician, gps?}
POST /api/sessions/{id}/call-confirmed     {phase: initial | final}
POST /api/sessions/{id}/position-marked    {phase: coarse | fine | live, step, headingDeg?}
POST /api/sessions/{id}/skip
GET  /api/sessions/{id}/poll               -> PollResponse (appendix A) + summary
GET  /api/sessions/{id}                    summary (for resuming)
POST /api/sessions/{id}/complete           {outcome?, note?, install?}
GET  /api/sessions/{id}/export
GET  /api/sites?lat=&lon=
GET  /api/concentrators/{serial}
GET  /api/export/observations.csv
GET  /api/me                               the name linked to the pairing code
GET  /api/config, /api/health
POST /api/check                            check without CALL (no-server mode only)
```

Compared with the handoff's proposal, `finish-coarse` and `start-fine` are not separate calls. The
winner is computed on every response, and fine-tuning starts with `position-marked`
(`phase: fine` or `live`). `skip` was added.

## Threat model (pilot)

| Risk | Measure | Still to do |
|---|---|---|
| Unauthorised access to app and registry | without a server: only invited users with Entra sign-in (Azure Static Web Apps); with a server: personal code per phone, stored as a fingerprint, revocable, sent in the URL fragment, which never reaches the server | – |
| Real data published with the code | the examples are invented; the real CSV files and QR codes are in `.gitignore` | – |
| Too many requests to Kamstrup | limit per meter, cache between calls | limit per user |
| Two installers on the same meter | lock with heartbeat (120 s), server mode only | – |
| Meter number used to alter the URL to Kamstrup | only 4–20 letters/digits accepted | – |
| Data from Kamstrup shown on the page | inserted only as text, never as HTML | – |
| Data loss | observations are written immediately; SQLite in WAL mode | scheduled backup of the file |
| Kamstrup endpoint without authentication and without a production agreement | the source is isolated in a replaceable adapter | agreement with Kamstrup |
| Unencrypted traffic | HTTPS on the hosting | – |
| A third-party concentrator makes a bad installation look good | only concentrators in the registry, active and owned by Kredsløb count; no registry, no measurement (fail closed) | owner column in the registry export |
| Code planted in VVS-dialog through li | li takes work only from LinkIQ addresses and sends results only there | signed li code (new bookmark) |

The full review and status: [SECURITY.md](SECURITY.md).
