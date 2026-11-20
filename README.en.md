# LinkIQ Field Assistant

docs/IDEER.md             ideas and planned tests (Danish), e.g. the 24-hour contact test
[Dansk](README.md) · **English** · [Română](docs/ro/README.md)

LinkIQ is a web app that can be installed on a phone (PWA). It guides the installer in aligning the
antenna of a Kamstrup heat meter, based on real radio measurements. It replaces the Power Apps
prototype and needs no paid licences. Open source, MIT licence.

Status: **v0.17**. The whole flow runs on the simulator and on Kamstrup responses captured in the
browser. A quick confirmation has been done on a real meter. A full rotation on a real meter is
still to be done.

Short guide for installers: [docs/en/GUIDE.md](docs/en/GUIDE.md) (Danish original:
[docs/VEJLEDNING_DA.md](docs/VEJLEDNING_DA.md)).

## Two ways to run

| | Without a server (default) | With a central server (optional) |
|---|---|---|
| What runs | only `frontend/`, as static pages | `backend/` + `frontend/` |
| Who calls Kamstrup | the phone's browser, directly | the server |
| Registry and sessions | on the device; exported as CSV | in the server's database |
| 5 s limit per meter | per device | central, for all phones |
| Lock when two installers test the same meter | no | yes |
| Pairing the phone with a code | not needed | yes |

The page decides by itself: if no LinkIQ server answers at its address, it runs without one.
Kamstrup allows the call directly from the browser (checked 12 Nov 2026).

## Starting without a server

**On a laptop, for a trial:** double-click `frontend/index.html`. Measuring works. Camera, GPS and
installing on the home screen need HTTPS, so they do not work from a file.

**On a phone, for a trial without hosting:** copy one file, `dist/linkiq.html`, to the phone and
open it in Chrome. Everything is built in. (The `frontend/` folder copied to the phone does not work,
because the phone does not let the page load the files next to it.) Build it with
`python tools/build_single.py`. Opened this way, the meter number is read by photographing the QR
code and the position is picked on the map. Live camera and GPS need an HTTPS address. Data may not
be kept between openings.

**On Android, full features without hosting:** Chrome treats `http://localhost` as a secure
address, so a small file server on the phone unlocks GPS, live camera, installing and stored data.
See [docs/en/ANDROID.md](docs/en/ANDROID.md).

**On the phones in daily use:** the app is published on Azure Static Web Apps (Free plan), for
invited users only. The installer opens the address, signs in with the work account and chooses
*Add to home screen*. See *Hosting and publishing* below.

### The registry without importing on every phone

The app looks for the registry in this order:

1. **Built into the app file.** `python tools/build_single.py --sites linkiq_sites.csv --concentrators linkiq_koncentratorer.csv --out ../linkiq-med-register.html`
   makes a single file with the app and your registry. Installers import nothing, and the file also
   works opened straight from the phone's storage. It contains the real locations:
   **do not publish it**.
2. **Next to the app on the server.** If `linkiq_sites.csv` and `linkiq_koncentratorer.csv` are in
   the same folder as `index.html`, they load automatically at start. Suitable for internal hosting
   with restricted access, not for a public address.
3. **Imported by hand**, once, from the card below: from the two CSV files, or from a QR code a colleague shows on
   screen or sends as a picture (*Lav en QR-kode af registret til kolleger*). The QR route is for work phones that
   may not save files from Teams or mail. Stays on the device until the next import.

A newer registry (built in or from the folder) replaces the old one once. A later manual import is
not overwritten.

In the card *Data on this device*:

- **Load sites / concentrators (CSV)**: the registry stays on the phone only. The columns
  `Breddegrad` / `Længdegrad`, decimal commas and files saved from Excel are accepted. Without a
  registry, every receiver that hears the meter is treated as our own.
- **Export measurements (CSV)**: all sessions on the device, for analysis.
- **Demo mode**: simulator, for training without a meter.

Tests: `node --test tests-js/engine.test.js`

## Starting with a central server

**Windows:** double-click `start.bat` (real Kamstrup API) or `start.bat sim`. Needs Python.

**By hand, on any system:**

```bash
cd backend
pip install -r requirements.txt
python scripts/import_registry.py --sites data/sites.sample.csv --concentrators data/concentrators.sample.csv
uvicorn app.main:app --port 8000
```

Tests: `pip install -r requirements-dev.txt && pytest`. With Docker: `docker compose up --build`.

## What is implemented

| Requirement from the handoff | Status |
|---|---|
| Central proxy to Kamstrup; the phone does not call Kamstrup directly (server mode) | yes |
| 5 s limit per meter, however many phones ask | yes |
| New observation = unseen fingerprint `serial\|timestamp\|rssi`; baseline at CALL | yes |
| Observations older than the positioning are not credited to the new position; missing timestamps handled explicitly | yes |
| Coarse sweep in 4 sectors (configurable), warning after 60 s without failing, skip a position | yes |
| A position counts as measured when the reference (strongest) receiver has answered, not at the first weak reading; late readings go to the position where they were taken | yes |
| All own receivers stored, weak ones included; foreign ones only in the log | yes |
| Pie with coloured sectors (blue / yellow / green / grey / light grey) | yes |
| Quick confirmation when the starting signal is strong | yes |
| Live fine-tuning in the winning sector: the reference receiver's signal on screen, no taps; updates when the receiver reports, every 20–30 s | yes |
| Final CALL and comparison with the best measurement | yes |
| Redundancy: a backup on another site is preferred over the same site; not recommended if it weakens the main link | yes (display; no separate sweep) |
| Session lock per meter with heartbeat and resume by the same installer (server mode) | yes |
| Receiver list, map with distance and direction | yes |
| Registry import (sites / concentrators) from CSV | yes |
| Export for Network Intelligence (`/api/export/observations.csv`) | yes |
| PWA: manifest, service worker, install on the home screen | yes |
| Pairing a phone with a personal QR code, revoking access (server mode) | yes |
| Scanning the meter number from the QR code | yes (extraction rule to be confirmed on a real meter) |
| QR code from a photo and picking the position on the map when the page does not run over HTTPS | yes |
| User interface in Danish (default) and Romanian, switch in the header | yes |
| Report at the end: image `<meter>.png` with sweep, fine-tuning, final check and receivers | yes |
| Photo of the antenna with the result written on it: `<meter>_antenne.jpg` | yes |
| Map with meter–site lines, signal and distance; the same map in the report | yes |
| Report also as PDF (`<meter>.pdf`) with the antenna photo on page 2 | yes |
| Checking a meter without a session and without CALL: who hears it now, and since when (`<meter>_status.pdf`) | yes, without a server only |
| Status check: each concentrator once; last contact within the last hour (≤ 75 min), occasional (≤ 8 h) or older (does not count); verdict on hourly data and redundancy; signal and contact limits written in the report | yes |
| Folder chosen by the installer for reports (created as `LinkIQ-rapporter`), with a list of saved reports; plain download where the browser lacks support | yes |
| Each meter's position is remembered on the device and reused when checking without CALL | yes |
| Installation details required when saving, chosen with large buttons and no defaults: meter level, internal/external antenna, antenna place; shown in report, photo and CSV export | yes |
| The meter's position can be set or corrected on the map after measuring, also when checking without CALL | yes |
| Feedback from the app through the phone's share sheet (Teams, mail) or clipboard | yes |
| Open the meter's case in VVS-dialog (button + bookmark `li`) | yes |
| Reading the printed meter number with the camera (OCR) | **no** |
| Microsoft Entra ID sign-in inside the app | **no**: access is controlled by the hosting (Azure) or by a pairing code (server) |
| Offline queue for actions | **no**: the session resumes after a lost connection, but actions are not queued |
| Compass guidance | partly: the phone's heading is stored if the browser provides it, but not used for guidance |

## Central server: test against the real Kamstrup API

The response format was checked on 12 Nov 2026: the receiver's number is in the `SerialNumber`
field of each element of `Links[]`, and the adapter reads it correctly.

On a laptop with internet access:

```bash
cd backend
python scripts/check_kamstrup.py <meter-number>         # one request: what the adapter sees
python scripts/import_registry.py --sites <sites.csv> --concentrators <concentrators.csv>
python scripts/pairing.py add --name Ana --url http://localhost:8000
KAMSTRUP_MODE=live uvicorn app.main:app --port 8000      # Windows: set KAMSTRUP_MODE=live
```

Open the pairing link printed by `pairing.py`, enter the number of the meter on your desk, press
CALL on the meter and confirm. The SIMULATOR label disappears in live mode.

Testing on a phone needs HTTPS (otherwise camera and GPS are blocked). Quickest:
`cloudflared tunnel --url http://localhost:8000` gives a temporary HTTPS address to the laptop.
Make the pairing link again with `--url` set to that address.

## Central server: pairing phones

The source code holds no data. The registry (sites, coordinates, concentrators) lives only in your
instance's database and is served only to paired phones. Another organisation runs its own instance
with its own registry.

- `python scripts/pairing.py add --name Ana --url https://your-address` creates a personal code and
  a file `pair-Ana.svg` with the QR code.
- The installer scans the QR code once; the app opens already paired in their name.
- `pairing.py revoke --name Ana` removes access immediately (lost phone, colleague left).
- The database keeps only the code's fingerprint, so the link cannot be shown again.

With `KAMSTRUP_MODE=live`, pairing is required by default: without a code the API answers 401.

## Scanning the meter number

The *Scan* button next to the meter number field opens the camera and reads the QR code. If the
code holds only the number, the field is filled in directly. If it holds several numbers, the app
lists them and the installer picks the right one. The exact content of Kamstrup's QR code is not
yet known; after a real scan the rule can be fixed so the number is picked automatically.

Reading the printed number (OCR) is not implemented.

## Opening the case in VVS-dialog (KMD)

Reports are uploaded to VVS-dialog by hand. LinkIQ cannot act there (another website, the
installer's own sign-in), so it only shortens the way:

- the *Open VVS-dialog* button next to the report copies the meter number and opens VVS-dialog with
  the number in the address (`#linkiq=…`) and as the tab's name;
- the bookmark `li`, created once in Chrome from the app, is started by the installer from the
  address bar of the VVS-dialog page. It searches for the meter, picks the case that is not
  *Afsluttet* or *Lukket* (lists them if there are several) and opens it. It does not upload,
  change or delete anything.

Bookmark source: `tools/vvs/bookmark.src.js`; `python tools/build_vvs.py` packs it into
`frontend/vvs.js`. On Android the bookmark only starts from the address bar, and the installed app
usually opens VVS-dialog in a window without an address bar (*⋮ → Open in Chrome*).

## Central server: hosting

| Option | Suitable? | Notes |
|---|---|---|
| Server / VM from IT | **yes, recommended** | runs exactly what is here; the registry stays in your infrastructure |
| Internal computer + Cloudflare Tunnel | yes | HTTPS without open firewall ports; Cloudflare Access can require Microsoft sign-in |
| Cloudflare Workers / Pages | not directly | does not run the Python server; it would have to be rewritten in JavaScript |
| Microsoft 365 / SharePoint | no | cannot run a server and does not serve HTML apps; only for the registry files |
| React Native | not hosting | a later native app would use the same server |

The server needs internet access to `check.kamstrup.com` and persistent storage for the SQLite file.

## Hosting and publishing

While the app is being developed, the working copy lives on GitHub. The pipeline in Azure DevOps
(*Målerservice-Udviklingsprojekt*) starts on every change to `main` on GitHub: it runs the engine
tests, copies `main` into the Azure Repos repository `linkiq` and publishes `frontend/` to
Azure Static Web Apps. Installers use only the Azure address.

- Copying into Azure Repos needs *… Build Service* to have the *Contribute* permission on the
  `linkiq` repository.
- Publishing needs two pipeline variables: `deployment_token` (secret; Static Web App →
  Overview → Manage deployment token) and `publish_enabled` = `true`. Until then the pipeline only
  tests and copies.

Access is set in `frontend/staticwebapp.config.json`: only invited users with the role `montor` get
in (Static Web App → Role management → Invite, provider Microsoft Entra ID). GitHub sign-in is
blocked. To invite a colleague: work e-mail, role `montor`, send them the link.

The real registry (sites and concentrators) is not put in the repository without the team's
agreement, even if the repository is private.

## Before the pilot

1. **The real registry**: export the two lists as CSV and import them. `Breddegrad` /
   `Længdegrad` and decimal commas are recognised; concentrators without a certain site become
   `REVIEW` / `MISSING_LOCATION`. While the registry is empty, every receiver is treated as our own.
   The real CSV files are kept out of git by `.gitignore`.
2. **HTTPS** on the final address.
3. **Thresholds**: the values in `.env.example` (−80 / −95 / −110 dBm, 6 dB) are provisional.
4. **Kamstrup**: the terms for using the endpoint in production are still to be confirmed.

## Layout

```
frontend/engine.js        all measuring logic on the device (no-server mode)
frontend/app.js           the user interface; the same in both modes
frontend/i18n.js          the Danish texts (source strings are Romanian)
frontend/vvs.js           the li bookmark for VVS-dialog (built from tools/vvs/)
frontend/                 PWA (HTML + CSS + plain JavaScript, no build step)
tests-js/                 18 tests for engine.js
backend/app/              optional central server: the same rules in Python
backend/scripts/          registry import, pairing codes, Kamstrup check
backend/tests/            18 tests
docs/en/                  guide, architecture and Android notes in English
docs/ro/                  the original Romanian documents
azure-pipelines.yml       tests, copy to Azure Repos and publishing to Azure
```
