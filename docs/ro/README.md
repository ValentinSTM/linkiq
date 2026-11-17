# LinkIQ Field Assistant

[Dansk](../../README.md) · [English](../../README.en.md) · **Română**

Versiunea principală a documentației este cea în daneză; aceasta poate rămâne în urmă.

Aplicație web instalabilă pe telefon (PWA) care ghidează instalatorul la orientarea antenei
unui contor de căldură Kamstrup, pe baza măsurătorilor radio reale. Înlocuiește prototipul
Power Apps, fără nicio licență plătită. Cod deschis, licență MIT.

Stadiu: **v0.2**. Fluxul complet rulează cap-coadă pe simulator și pe răspunsuri Kamstrup
interceptate în browser. Un baleiaj complet pe un contor real încă nu a fost făcut.

## Două moduri de rulare

| | Fără server (implicit) | Cu server central (opțional) |
|---|---|---|
| Ce rulează | doar dosarul `frontend/`, ca pagini statice | `backend/` + `frontend/` |
| Cine apelează Kamstrup | browserul de pe telefon, direct | serverul |
| Registrul și sesiunile | pe dispozitiv; se exportă ca CSV | în baza de date a serverului |
| Limita de 5 s per contor | per dispozitiv | centrală, pentru toate telefoanele |
| Blocare când doi instalatori testează același contor | nu | da |
| Cuplarea telefonului prin cod | nu este necesară | da |

Pagina alege singură: dacă la adresa ei nu răspunde un server LinkIQ, lucrează fără server.
Kamstrup permite apelul direct din browser (verificat pe 12.11.2026).

## Pornire fără server

**Pe laptop, pentru o probă:** dublu-clic pe `frontend/index.html`. Măsurarea funcționează; camera,
GPS-ul și instalarea pe ecranul principal cer HTTPS, deci nu merg din fișier.

**Pe telefon, pentru o probă fără găzduire:** copiază pe telefon un singur fișier, `dist/linkiq.html`,
și deschide-l în Chrome. Are totul înăuntru. (Dosarul `frontend/` copiat pe telefon nu funcționează:
telefonul nu lasă pagina să-și încarce fișierele vecine.) Se reface cu `python tools/build_single.py`.
Deschis așa, seria se citește fotografiind codul QR, iar poziția se alege pe hartă; camera live și
GPS-ul telefonului cer o adresă HTTPS. Datele pot să nu se păstreze între deschideri.

**Pe Android, cu funcționalitate completă și fără găzduire:** Chrome tratează `http://localhost` ca
adresă sigură, deci un mic server de fișiere pe telefon deblochează GPS-ul, camera live, instalarea pe
ecranul principal și păstrarea datelor. Vezi [ANDROID.md](ANDROID.md).

**Pe telefoane:** aplicația se publică pe Azure Static Web Apps (plan Free), doar pentru utilizatorii
invitați. Instalatorul deschide adresa, se loghează cu contul de serviciu și alege „Adaugă pe ecranul
principal”. Vezi „Găzduire și publicare” mai jos.

### Registrul fără import pe fiecare telefon

Aplicația caută registrul în această ordine:

1. **Inclus în fișierul aplicației.** `python tools/build_single.py --sites linkiq_sites.csv --concentrators linkiq_koncentratorer.csv --out ../linkiq-med-register.html`
   produce un singur fișier cu aplicația și registrul vostru. Montorii nu importă nimic, iar fișierul
   funcționează și deschis direct din memoria telefonului. Conține locațiile reale: **nu se publică**.
2. **Lângă aplicație, pe server.** Dacă `linkiq_sites.csv` și `linkiq_koncentratorer.csv` stau în același
   dosar cu `index.html`, se încarcă singure la pornire. Potrivit pentru găzduire internă, cu acces
   restricționat; nu pentru o adresă publică.
3. **Importat manual**, o singură dată, din cardul de mai jos. Rămâne pe dispozitiv până la un nou import.

Un registru mai nou (inclus sau din dosar) îl înlocuiește pe cel vechi o singură dată; un import
manual ulterior nu este suprascris.

În cardul „Date pe acest dispozitiv”:

- **Încarcă site-uri / concentratoare (CSV)** – registrul rămâne doar pe telefon. Se acceptă
  coloanele `Breddegrad` / `Længdegrad`, virgula zecimală și fișiere salvate din Excel. Fără
  registru, toate receptoarele auzite sunt tratate ca proprii.
- **Exportă măsurătorile (CSV)** – toate sesiunile de pe dispozitiv, pentru analiză.
- **Mod demonstrație** – simulator, pentru instruire fără contor.

Teste: `node --test tests-js/engine.test.js`

## Pornire cu server central

**Windows:** dublu-clic pe `start.bat` (API-ul real Kamstrup) sau `start.bat sim`. Are nevoie de
Python instalat.

**Manual, pe orice sistem:**

```bash
cd backend
pip install -r requirements.txt
python scripts/import_registry.py --sites data/sites.sample.csv --concentrators data/concentrators.sample.csv
uvicorn app.main:app --port 8000
```

Teste: `pip install -r requirements-dev.txt && pytest`. Cu Docker: `docker compose up --build`.

## Ce este implementat

| Cerință din handoff | Stare |
|---|---|
| Proxy central către Kamstrup; telefonul nu apelează Kamstrup direct | da |
| Limită de 5 s per contor, indiferent câte telefoane interoghează | da |
| Observație nouă = amprentă `serial\|timestamp\|rssi` nevăzută; baseline la CALL | da |
| Observațiile mai vechi decât momentul poziționării nu se atribuie noii poziții; timestamp lipsă tratat explicit | da |
| Baleiaj grosier în 4 felii (numărul se poate schimba), avertizare după 60 s fără a eșua, salt peste poziție | da |
| O poziție e măsurată când a răspuns receptorul de referință (cel mai puternic), nu la prima citire slabă; citirile sosite târziu se atribuie poziției la care au fost luate | da |
| Toate receptoarele proprii salvate, inclusiv cele slabe; cele externe doar în jurnal | da |
| Pizza cu felii colorate (albastru / galben / verde / gri / gri deschis) | da |
| Confirmare rapidă la semnal inițial puternic | da |
| Reglaj fin live în felia câștigătoare: semnalul receptorului de referință pe ecran, fără apăsări; se actualizează când raportează receptorul, la 20–30 s | da |
| CALL final și comparație cu cea mai bună măsurătoare | da |
| Redundanță: rezervă pe alt site preferată celei de pe același site; nu se recomandă dacă slăbește legătura principală | da (afișare; fără baleiaj dedicat) |
| Blocare sesiune per contor, cu heartbeat și reluare de către același instalator | da |
| Listă receptoare, hartă cu distanță și direcție | da |
| Import registru Site / Concentrator din CSV | da |
| Export pentru Network Intelligence (`/api/export/observations.csv`) | da |
| PWA: manifest, service worker, instalare pe ecranul principal | da |
| Cuplarea telefonului prin cod QR personal, retragere acces | da |
| Scanarea seriei contorului din codul QR | da (regula de extragere de confirmat pe un contor real) |
| Citirea codului QR dintr-o fotografie și alegerea poziției pe hartă, când pagina nu rulează prin HTTPS | da |
| Interfață în daneză (implicit) și română, comutabilă din antet | da |
| Raport la finalul sesiunii: imagine `<seria>.png` cu baleiajul, reglajul fin, confirmarea finală și receptoarele | da |
| Fotografie a antenei cu rezultatul scris pe ea: `<seria>_antenne.jpg` | da |
| Hartă cu linii contor–site, semnal și distanță; aceeași hartă în raport | da |
| Raport și ca PDF (`<seria>.pdf`), cu fotografia antenei pe pagina a doua | da |
| Verificarea unui contor fără sesiune și fără CALL: cine îl aude acum și de când (`<seria>_status.pdf`) | da, doar în varianta fără server |
| Dosar ales de montor pentru rapoarte (creat ca `LinkIQ-rapporter`), cu lista rapoartelor salvate; fără suport în browser, se folosește descărcarea obișnuită | da |
| Poziția fiecărui contor se ține minte pe dispozitiv și se refolosește la verificarea fără CALL | da |
| Date de montaj obligatorii la salvare, alese din butoane mari fără valori implicite: nivelul contorului, antenă internă/externă, locul antenei; apar în raport, pe fotografie și în exportul CSV | da |
| Poziția contorului se poate indica sau corecta pe hartă și după măsurătoare, inclusiv la verificarea fără CALL | da |
| Citirea seriei tipărite cu camera (OCR) | **nu** |
| Autentificare Microsoft Entra ID | **nu** – cuplare prin cod personal |
| Coadă offline pentru acțiuni | **nu** – sesiunea se reia după pierderea conexiunii, dar acțiunile nu se pun în coadă |
| Citire busolă pentru ghidare | parțial – direcția telefonului se salvează dacă browserul o oferă, nu se folosește la ghidare |

## Server central: test cu API-ul real Kamstrup

Formatul răspunsului real a fost verificat pe 12.11.2026: seria receptorului este în câmpul
`SerialNumber` al fiecărui element din `Links[]`, iar adaptorul îl citește corect.

Pe un laptop cu acces la internet:

```bash
cd backend
python scripts/check_kamstrup.py <seria-contorului>     # o singură cerere: ce vede adaptorul
python scripts/import_registry.py --sites <site.csv> --concentrators <concentratoare.csv>
python scripts/pairing.py add --name Ana --url http://localhost:8000
KAMSTRUP_MODE=live uvicorn app.main:app --port 8000      # Windows: set KAMSTRUP_MODE=live
```

Deschide linkul de cuplare afișat de `pairing.py`, introdu seria contorului de pe birou, apasă CALL
pe contor și confirmă. Eticheta SIMULATOR dispare în modul live.

Pentru test pe telefon este nevoie de HTTPS (altfel camera și GPS-ul sunt blocate). Cel mai rapid:
`cloudflared tunnel --url http://localhost:8000` dă o adresă HTTPS temporară către laptop; refă
linkul de cuplare cu `--url` pe acea adresă.

## Server central: cuplarea telefoanelor

Codul sursă nu conține date. Registrul (site-uri, coordonate, concentratoare) stă doar în baza de
date a instanței voastre și este servit numai telefoanelor cuplate. Altă organizație își pornește
propria instanță, cu propriul registru.

- `python scripts/pairing.py add --name Ana --url https://adresa-voastră` creează un cod personal
  și un fișier `pair-Ana.svg` cu codul QR.
- Instalatorul scanează QR-ul o singură dată; aplicația se deschide deja cuplată pe numele lui.
- `pairing.py revoke --name Ana` retrage accesul imediat (telefon pierdut, coleg plecat).
- În baza de date se păstrează doar amprenta codului, deci linkul nu poate fi reafișat.

Cu `KAMSTRUP_MODE=live` cuplarea este obligatorie implicit: fără cod, API-ul răspunde 401.

## Scanarea seriei contorului

Butonul „Scanează” de lângă câmpul seriei deschide camera și citește codul QR. Dacă codul conține
doar seria, câmpul se completează direct; dacă conține mai multe numere, aplicația le afișează și
instalatorul o alege pe cea corectă. Conținutul exact al QR-ului Kamstrup nu este încă cunoscut –
după o scanare reală, regula se poate fixa ca seria să fie aleasă automat.

Citirea seriei tipărite (OCR) nu este implementată.

## Deschiderea cazului în VVS-dialog (KMD)

Rapoartele se încarcă manual în VVS-dialog. LinkIQ nu poate acționa acolo (alt site, login-ul
instalatorului), așa că doar scurtează drumul:

- butonul „Deschide VVS-dialog” de lângă raport copiază seria contorului și deschide VVS-dialog,
  cu seria în adresă (`#linkiq=…`) și ca nume al filei;
- bookmark-ul `li`, creat o singură dată în Chrome din aplicație, este pornit de instalator din
  bara de adrese a paginii VVS-dialog. Caută contorul, alege cazul care nu este „Afsluttet” sau
  „Lukket” (dacă sunt mai multe, le arată) și îl deschide. Nu încarcă, nu modifică și nu șterge.

Codul bookmark-ului: `tools/vvs/bookmark.src.js`; `python tools/build_vvs.py` îl împachetează în
`frontend/vvs.js`. Pe Android bookmark-ul pornește doar din bara de adrese, iar aplicația instalată
deschide de obicei VVS-dialog într-o fereastră fără bară de adrese („⋮ → Deschide în Chrome”).

## Server central: găzduire

| Variantă | Potrivită? | Observații |
|---|---|---|
| Server / VM de la IT | **da, recomandat** | rulează exact ce este aici; registrul rămâne în infrastructura voastră |
| Calculator intern + Cloudflare Tunnel | da | HTTPS fără porturi deschise în firewall; Cloudflare Access poate cere și login Microsoft |
| Cloudflare Workers / Pages | nu direct | nu rulează serverul Python; ar cere rescrierea lui în JavaScript |
| Microsoft 365 / SharePoint | nu | nu poate rula un server; bun doar ca sursă pentru fișierele registrului |
| React Native | nu este găzduire | o aplicație nativă ulterioară ar folosi același server |

Serverul are nevoie de ieșire la internet către `check.kamstrup.com` și de un volum persistent
pentru fișierul SQLite.

## Găzduire și publicare

Cât timp aplicația se dezvoltă, copia de lucru este pe GitHub. Pipeline-ul din Azure DevOps
(*Målerservice-Udviklingsprojekt*) pornește la fiecare modificare pe `main` de pe GitHub: rulează
testele motorului, copiază `main` în depozitul Azure Repos `linkiq` și publică `frontend/` pe
Azure Static Web Apps. Montorii folosesc doar adresa din Azure. Copierea în Azure Repos cere ca
„… Build Service” să aibă dreptul *Contribute* pe depozitul `linkiq`. Pipeline-ul are nevoie de o singură variabilă secretă, `deployment_token`
(Static Web App → Overview → Manage deployment token).

Accesul este stabilit în `frontend/staticwebapp.config.json`: intră doar utilizatorii invitați cu
rolul `montor` (Static Web App → Role management → Invite, provider Microsoft Entra ID). Login-ul
cu GitHub este blocat. Invitarea unui coleg: e-mailul de serviciu, rolul `montor`, linkul trimis lui.

Registrul real (site-uri și concentratoare) nu se pune în depozit fără acordul echipei, chiar dacă
depozitul este privat.

## Înainte de pilot

1. **Registrul real**: exportă cele două liste ca CSV și importă-le. `Breddegrad` / `Længdegrad` și
   virgula zecimală sunt recunoscute; concentratoarele fără site sigur devin `REVIEW` /
   `MISSING_LOCATION`. Cât timp registrul e gol, toate receptoarele sunt tratate ca proprii.
   Fișierele CSV reale sunt excluse din git prin `.gitignore`.
2. **HTTPS** pe adresa finală.
3. **Praguri**: valorile din `.env.example` (−80 / −95 / −110 dBm, 6 dB) sunt provizorii.
4. **Kamstrup**: condițiile de folosire a endpoint-ului în producție rămân de confirmat, cu atât
   mai mult dacă proiectul devine public.

## Structură

```
frontend/engine.js        toată logica de măsurare, pe dispozitiv (modul fără server)
frontend/app.js           interfața; aceeași în ambele moduri
frontend/i18n.js          textele în daneză (sursa este în română)
frontend/                 PWA (HTML + CSS + JavaScript simplu, fără pas de build)
tests-js/                 18 teste pentru engine.js
backend/app/              server central opțional: aceleași reguli, în Python
backend/scripts/          import registru, coduri de cuplare, verificare Kamstrup
backend/tests/            18 teste
docs/ro/ARHITECTURA.md    alternativa aleasă, licențe, API, model de amenințări
```
