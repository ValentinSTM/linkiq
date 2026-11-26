# Security and production approval

[Dansk](../SIKKERHED.md) · **English** · [Română](../ro/SECURITATE.md)

Status of every recommendation from the security review of 26.11.2026, as of LinkIQ v0.25. Each item
is marked **Done** (changed in the app), **Already met** (the app already did it, verified in code
and tests), or **Decision** (needs a decision or work outside the code, by Kredsløb).

## Summary

| Area | Verdict | Status |
|---|---|---|
| Purpose: on-demand diagnosis of one meter, read-only | green | Already met |
| Kamstrup: one meter at a time, at most one request per 5 s, no scraping | green | Already met |
| HTTP 200 is not a new measurement (baseline + fingerprint) | green | Already met |
| Receivers of other owners never decide the result | was red with an empty registry | **Done**: fail closed |
| Ownership and `active` explicit in the registry | yellow | **Done** in the app; the export is a **Decision** |
| Input (meter number) validated and URL-encoded | green | Already met |
| DOM/XSS: text only, never HTML | green/yellow | **Done**: map labels as text, CSP also on GitHub Pages |
| Service worker does not cache RF data | green | Already met |
| Data on the phone: retention | yellow | **Done**: limits in the app; the numbers are a **Decision** |
| Photos: what may be photographed | yellow | **Done**: rule shown in the app; the policy is a **Decision** |
| OpenStreetMap (tiles, address search) | yellow | **Decision** |
| Bookmark li (runs in VVS-dialog) | yellow | **Done** in part; one risk left, see below |
| Source code on a personal GitHub account | yellow/red | **Decision**: Azure Repos as the source |
| Hosting with Entra ID (role `montor`) | green | Prepared (`staticwebapp.config.json`); **Decision** |
| RSSI thresholds −80 / −95 / −110 dBm | provisional | Unchanged until field data |
| Dependencies (Leaflet, jsQR, qrcode, no npm) | green | Already met |

## Changed in v0.25

### 1. Fail closed: no registry, no result

Before: when no registry was loaded, every receiver that heard the meter counted as Kredsløb's. A
strong third-party concentrator could then make a bad installation look good.

Now:

- Without a registry, **no measurement and no status check can start**. Kamstrup is not even asked.
  The installer sees: *"Kredsløbs koncentratorregister er ikke indlæst … målingen kan ikke
  godkendes. Indlæs registret (QR-kode) på startskærmen."* The registry card on the start screen
  says the same.
- A concentrator counts in a result only when it is **in the registry, active and Kredsløb's**:
  - `active` = 0 / false / nej / no: never counts;
  - a column `Ownership` / `Owner` / `Ejer` / `Ejerskab`, when present, must say Kredsløb (also
    "Kredslob", "Kredsløb A/S"). Any other owner never counts;
  - without an owner column the whole list is taken as Kredsløb's list, as before. The app then
    says so on the start screen.
- Receivers of other owners are only kept in the session log, marked not owned; they never become
  primary or backup, and they are not shown as ours.
- The registry QR code carries the owner column, so a colleague's phone gets the same rules.
- The demo (simulator) still runs without a registry, for training.
- The optional server (`backend/`) follows the same rule in real mode.

Tests: `tests-js/engine.test.js` (no registry, other owner at −67 dBm against ours at −91 dBm,
inactive, QR copy, demo) and `backend/tests/test_workflow.py`.

### 2. li accepts work only from LinkIQ

li (the bookmark) runs inside VVS-dialog with the installer's session. It now:

- takes reports and texts from the opening tab only when that tab is LinkIQ (exact host names:
  `valentinstm.github.io`, `*.kredslob.dk`, and this computer for tests);
- sends results back only to that LinkIQ, never to any page;
- uses the "Tilbage til LinkIQ" address only when it is a LinkIQ address.

li never deletes anything in VVS-dialog: it searches the case, lists its files, uploads the report
and writes Ny aktivitet with status, only after the installer taps it.

### 3. Text only on the map

Map labels (site name, address, signal) were handed to Leaflet as text that it writes as HTML. A
registry with HTML in a name could then put code into the page. Labels are now plain text nodes.
Everything else was already written with `textContent`; the app has no `innerHTML`.

### 4. Content-Security-Policy on every host

The Azure configuration already had a strict policy. GitHub Pages cannot send headers, so the same
policy now sits in `index.html` as a meta tag: scripts only from the app itself; network only to the
app, `check.kamstrup.com` and `nominatim.openstreetmap.org`; images also from
`tile.openstreetmap.org`; no plugins, no forms to other sites. A browser test runs every function
(map, address search, QR, camera, meter display, PDF, VVS-dialog) and finds no violation. The
single-file version (`dist/linkiq.html`) has its scripts inline and therefore no such tag. Azure also
gets `Strict-Transport-Security`.

### 5. Retention on the phone

| Data | Kept |
|---|---|
| Measurement sessions | 365 days, at most 200 |
| Saved meter positions (coordinates only) | 365 days |
| Installation photos of a session never finished | 30 days |
| VVS list: sent entries and their files | 7 days |
| VVS list: entries not sent | until sent or deleted (so no case is lost) |

The numbers are settings (`keepSessionsDays`, `keepPositionsDays` in `engine.js`,
`PHOTO_KEEP_DAYS` in `app.js`) and can be changed when Kredsløb decides other values. The "Slet de
gemte målinger" button still deletes everything at once. Reports saved as files (Downloads or the
chosen folder) are outside the app.

### 6. Photo rule in the app

The installation photo card says: *"Kun udstyret og installationen: ingen personer, papirer eller
kundens personlige ting."*

## Already met (no change needed)

- **Read-only towards Kamstrup**; one request per meter typed or scanned by the installer; 5 s cache
  per meter (test: ten polls within 5 s give one request).
- **Baseline and fingerprint** (`serial | timestamp | RSSI`): the snapshot before CALL is never a
  measurement (test).
- **Mapping never guessed**: an unknown site is `REVIEW`, a missing one `MISSING_LOCATION`.
- **Distance does not decide**; radio measurement does.
- **Redundancy**: `PRIMARY`, `SAME_SITE`, `DISTINCT_SITE`, `UNKNOWN_SITE`; another site is
  preferred.
- **No trackers, analytics or hidden uploads**; libraries are local files.
- **Service worker** caches the app only; Kamstrup and other hosts are never cached.
- **Meter number** checked against `^[0-9A-Za-z]{4,20}$` and URL-encoded.

## Decisions for Kredsløb

1. **Source and hosting.** Make Azure Repos the source of truth and publish to Azure Static Web
   Apps with Entra ID and the `montor` role (configuration ready in
   `frontend/staticwebapp.config.json`, pipeline in `azure-pipelines.yml`). GitHub then becomes a
   mirror or is closed. Today the app's code (without registry) is public on GitHub Pages. When the
   Azure host is known, add its exact name to `LIQ_ORIGIN` in `tools/vvs/bookmark.src.js` (a
   `*.kredslob.dk` name is already allowed).
2. **Registry export.** Export the concentrator list with the columns `serialNumber`, `siteCode`,
   `active`, `Ownership` (plus the site list with coordinates). The registry is never put in a
   repository; it travels as a QR code or file.
3. **Map provider.** OpenStreetMap sees which map squares a phone loads (the area around the meter)
   and, with address search, the address typed. Options: accept (no personal data, no customer
   names), switch to Azure Maps (needs a key bound to the Kredsløb host), or turn off address search.
4. **Retention numbers** (table above) and **photo policy** (including how long reports and photos
   stay in VVS-dialog, which follows VVS-dialog's own rules).
5. **Kamstrup.** Ask Kamstrup to confirm in writing that READy Device Check may be used this way
   (one meter at a time, at most one request per 5 s).
6. **Thresholds.** −80 / −95 / −110 dBm and 6 dB stay provisional until compared with how complete
   the hourly data really is (field visit reports).

## li: remaining risk and the fix

The short bookmark (the loader) takes the li code from the tab name, from the opening tab, or from
what it saved earlier, and does not check who wrote it. A malicious web page that opens VVS-dialog
in the same tab could therefore plant code, which would run in VVS-dialog **if the installer then
taps li**. The full li code (which comes from LinkIQ and updates itself) is already protected; the
loader is not, because it lives in each phone's bookmark.

Fix: sign the li code. LinkIQ's build signs it with a private key kept by Kredsløb IT (pipeline
secret, never in the repository); the loader holds the public key and runs only correctly signed
code. This needs **a new bookmark on every phone once**, so it is planned together with the move to
Azure. Until then: open VVS-dialog only from LinkIQ or from the bookmark "Kredsløb", and tap li
only on VVS-dialog opened that way.

The Tampermonkey user script (PC only) needs IT's approval before use.

## How it was checked

- `node --test tests-js/engine.test.js tests-js/lcd.test.js` (engine incl. fail closed, display reader)
- `python -m pytest backend/tests` (server mode incl. fail closed)
- browser tests of the whole flow, li against a copy of VVS-dialog, and a CSP test that runs every
  function and requires zero violations
- the same steps on the published version before and after, with identical results
