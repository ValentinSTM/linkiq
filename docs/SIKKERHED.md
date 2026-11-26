# Sikkerhed og driftsgodkendelse

**Dansk** · [English](en/SECURITY.md) · [Română](ro/SECURITATE.md)

Status for hver anbefaling fra sikkerhedsgennemgangen 26.11.2026, pr. LinkIQ v0.25. Hvert punkt er
markeret **Gjort** (ændret i appen), **Opfyldt** (appen gjorde det allerede, kontrolleret i kode og
test) eller **Beslutning** (kræver en beslutning eller arbejde uden for koden, hos Kredsløb).

## Sammenfatning

| Område | Vurdering | Status |
|---|---|---|
| Formål: diagnose af én måler efter behov, kun læsning | grøn | Opfyldt |
| Kamstrup: én måler ad gangen, højst én forespørgsel pr. 5 s, ingen scraping | grøn | Opfyldt |
| HTTP 200 er ikke en ny måling (baseline + fingeraftryk) | grøn | Opfyldt |
| Andre ejeres modtagere afgør aldrig resultatet | var rød med tomt register | **Gjort**: fail closed |
| Ejerskab og `active` eksplicit i registret | gul | **Gjort** i appen; eksporten er en **Beslutning** |
| Input (målernummer) valideret og URL-kodet | grøn | Opfyldt |
| DOM/XSS: kun tekst, aldrig HTML | grøn/gul | **Gjort**: kortetiketter som tekst, CSP også på GitHub Pages |
| Service worker gemmer ikke RF-data | grøn | Opfyldt |
| Data på telefonen: opbevaring | gul | **Gjort**: grænser i appen; tallene er en **Beslutning** |
| Billeder: hvad må fotograferes | gul | **Gjort**: reglen vises i appen; politikken er en **Beslutning** |
| OpenStreetMap (kortfliser, adressesøgning) | gul | **Beslutning** |
| Bogmærket li (kører i VVS-dialog) | gul | Delvist **Gjort**; én risiko tilbage, se nedenfor |
| Kildekode på en personlig GitHub-konto | gul/rød | **Beslutning**: Azure Repos som kilde |
| Hosting med Entra ID (rollen `montor`) | grøn | Forberedt (`staticwebapp.config.json`); **Beslutning** |
| RSSI-grænser −80 / −95 / −110 dBm | foreløbige | Uændret indtil feltdata |
| Afhængigheder (Leaflet, jsQR, qrcode, ingen npm) | grøn | Opfyldt |

## Ændret i v0.25

### 1. Fail closed: intet register, intet resultat

Før: var der intet register indlæst, talte alle modtagere, der hørte måleren, som Kredsløbs. En
stærk koncentrator hos en tredjepart kunne så få en dårlig installation til at se god ud.

Nu:

- Uden register kan **hverken måling eller statuskontrol starte**. Kamstrup bliver ikke engang
  spurgt. Montøren ser: *"Kredsløbs koncentratorregister er ikke indlæst … målingen kan ikke
  godkendes. Indlæs registret (QR-kode) på startskærmen."* Registerkortet på startskærmen siger
  det samme.
- En koncentrator tæller kun i et resultat, når den er **i registret, aktiv og Kredsløbs**:
  - `active` = 0 / false / nej / no: tæller aldrig;
  - en kolonne `Ownership` / `Owner` / `Ejer` / `Ejerskab` skal, når den findes, sige Kredsløb
    (også „Kredslob", „Kredsløb A/S"). Enhver anden ejer tæller aldrig;
  - uden ejerkolonne regnes hele listen som Kredsløbs liste, som før. Det står så på startskærmen.
- Andre ejeres modtagere gemmes kun i sessionens log, markeret som ikke egne; de bliver aldrig
  primær eller reserve og vises ikke som vores.
- Registrets QR-kode bærer ejerkolonnen med, så en kollegas telefon får de samme regler.
- Demotilstanden (simulator) virker stadig uden register, til oplæring.
- Den valgfri server (`backend/`) følger samme regel i rigtig tilstand.

Test: `tests-js/engine.test.js` (intet register, anden ejer på −67 dBm mod vores på −91 dBm,
inaktiv, QR-kopi, demo) og `backend/tests/test_workflow.py`.

### 2. li tager kun imod arbejde fra LinkIQ

li (bogmærket) kører inde i VVS-dialog med montørens session. Nu:

- tager li kun rapporter og tekster fra den åbnende fane, når den fane er LinkIQ (præcise
  værtsnavne: `valentinstm.github.io`, `*.kredslob.dk` og denne computer til test);
- sender li kun resultater tilbage til den LinkIQ, aldrig til en vilkårlig side;
- bruger li kun adressen bag „Tilbage til LinkIQ", når den er en LinkIQ-adresse.

li sletter aldrig noget i VVS-dialog: den finder sagen, læser filerne, uploader rapporten og skriver
Ny aktivitet med status, kun når montøren trykker.

### 3. Kun tekst på kortet

Kortetiketter (sitenavn, adresse, signal) blev givet til Leaflet som tekst, som den skriver som
HTML. Et register med HTML i et navn kunne så lægge kode ind på siden. Etiketterne er nu ren tekst.
Alt andet blev allerede skrevet med `textContent`; appen bruger ikke `innerHTML`.

### 4. Content-Security-Policy på alle værter

Azure-konfigurationen havde allerede en streng politik. GitHub Pages kan ikke sende headers, så den
samme politik står nu i `index.html` som meta-tag: scripts kun fra appen selv; netværk kun til
appen, `check.kamstrup.com` og `nominatim.openstreetmap.org`; billeder også fra
`tile.openstreetmap.org`; ingen plugins og ingen formularer til andre sider. En browsertest kører
alle funktioner (kort, adressesøgning, QR, kamera, måleraflæsning, PDF, VVS-dialog) og finder ingen
overtrædelser. Enkeltfilsversionen (`dist/linkiq.html`) har sine scripts indbygget og derfor ikke
dette tag. Azure får også `Strict-Transport-Security`.

### 5. Opbevaring på telefonen

| Data | Gemmes |
|---|---|
| Målesessioner | 365 dage, højst 200 |
| Gemte målerpositioner (kun koordinater) | 365 dage |
| Installationsbilleder fra en session, der aldrig blev afsluttet | 30 dage |
| VVS-listen: sendte poster og deres filer | 7 dage |
| VVS-listen: poster, der ikke er sendt | indtil de sendes eller slettes (så ingen sag går tabt) |

Tallene er indstillinger (`keepSessionsDays`, `keepPositionsDays` i `engine.js`, `PHOTO_KEEP_DAYS` i
`app.js`) og kan ændres, når Kredsløb beslutter andre værdier. Knappen „Slet de gemte målinger"
sletter stadig alt på én gang. Rapporter gemt som filer (Overførsler eller den valgte mappe) ligger
uden for appen.

### 6. Billedregel i appen

Kortet med installationsbilleder siger: *„Kun udstyret og installationen: ingen personer, papirer
eller kundens personlige ting."*

## Opfyldt (ingen ændring nødvendig)

- **Kun læsning hos Kamstrup**; én forespørgsel pr. måler, som montøren har skrevet eller scannet;
  5 s cache pr. måler (test: ti forespørgsler inden for 5 s giver én).
- **Baseline og fingeraftryk** (`serienummer | tidsstempel | RSSI`): øjebliksbilledet før CALL er
  aldrig en måling (test).
- **Tilknytning gættes aldrig**: et ukendt site er `REVIEW`, et manglende `MISSING_LOCATION`.
- **Afstand afgør ikke**; radiomålingen gør.
- **Redundans**: `PRIMARY`, `SAME_SITE`, `DISTINCT_SITE`, `UNKNOWN_SITE`; et andet site foretrækkes.
- **Ingen trackere, analytics eller skjulte uploads**; bibliotekerne er lokale filer.
- **Service worker** gemmer kun appen; Kamstrup og andre værter gemmes aldrig.
- **Målernummer** kontrolleres mod `^[0-9A-Za-z]{4,20}$` og URL-kodes.

## Beslutninger for Kredsløb

1. **Kilde og hosting.** Gør Azure Repos til den autoritative kilde, og udgiv til Azure Static Web
   Apps med Entra ID og rollen `montor` (konfigurationen er klar i
   `frontend/staticwebapp.config.json`, pipelinen i `azure-pipelines.yml`). GitHub bliver så et spejl
   eller lukkes. I dag er appens kode (uden register) offentlig på GitHub Pages. Når Azure-værten
   kendes, tilføjes dens præcise navn til `LIQ_ORIGIN` i `tools/vvs/bookmark.src.js` (et
   `*.kredslob.dk`-navn er allerede tilladt).
2. **Eksport af registret.** Eksportér koncentratorlisten med kolonnerne `serialNumber`, `siteCode`,
   `active`, `Ownership` (plus sitelisten med koordinater). Registret lægges aldrig i et depot; det
   overføres som QR-kode eller fil.
3. **Kortleverandør.** OpenStreetMap ser, hvilke kortfliser en telefon henter (området omkring
   måleren), og ved adressesøgning den skrevne adresse. Muligheder: acceptere (ingen
   personoplysninger, ingen kundenavne), skifte til Azure Maps (kræver en nøgle bundet til Kredsløbs
   vært) eller slå adressesøgningen fra.
4. **Opbevaringstal** (tabellen ovenfor) og **billedpolitik** (herunder hvor længe rapporter og
   billeder bliver i VVS-dialog, hvilket følger VVS-dialogs egne regler).
5. **Kamstrup.** Bed Kamstrup bekræfte skriftligt, at READy Device Check må bruges på denne måde (én
   måler ad gangen, højst én forespørgsel pr. 5 s).
6. **Grænseværdier.** −80 / −95 / −110 dBm og 6 dB forbliver foreløbige, indtil de er sammenlignet
   med, hvor komplette timedata faktisk er (besøgsrapporterne fra feltet).

## li: den tilbageværende risiko og løsningen

Det korte bogmærke (indlæseren) tager li-koden fra fanens navn, fra den åbnende fane eller fra det,
den gemte tidligere, og kontrollerer ikke, hvem der skrev den. En ondsindet webside, der åbner
VVS-dialog i samme fane, kunne derfor plante kode, som ville køre i VVS-dialog, **hvis montøren
derefter trykker li**. Den fulde li-kode (som kommer fra LinkIQ og opdaterer sig selv) er allerede
beskyttet; indlæseren er ikke, fordi den ligger i hver telefons bogmærke.

Løsning: signér li-koden. LinkIQs build signerer den med en privat nøgle, som Kredsløbs IT opbevarer
(pipeline-hemmelighed, aldrig i depotet); indlæseren har den offentlige nøgle og kører kun korrekt
signeret kode. Det kræver **et nyt bogmærke på hver telefon én gang**, så det planlægges sammen med
flytningen til Azure. Indtil da: åbn kun VVS-dialog fra LinkIQ eller fra bogmærket „Kredsløb", og
tryk kun li i VVS-dialog åbnet på den måde.

Tampermonkey-brugerscriptet (kun pc) kræver IT's godkendelse før brug.

## Sådan er det kontrolleret

- `node --test tests-js/engine.test.js tests-js/lcd.test.js` (motor inkl. fail closed, måleraflæsning)
- `python -m pytest backend/tests` (servertilstand inkl. fail closed)
- browsertest af hele forløbet, li mod en kopi af VVS-dialog, og en CSP-test, der kører alle
  funktioner og kræver nul overtrædelser
- de samme trin på den udgivne version før og efter, med identiske resultater
