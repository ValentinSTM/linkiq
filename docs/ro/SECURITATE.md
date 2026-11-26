# Securitate și aprobarea pentru producție

[Dansk](../SIKKERHED.md) · [English](../en/SECURITY.md) · **Română**

Starea fiecărei recomandări din analiza de securitate din 26.11.2026, la LinkIQ v0.25. Fiecare punct
e marcat **Făcut** (schimbat în aplicație), **Îndeplinit** (aplicația o făcea deja, verificat în cod și
teste) sau **Decizie** (cere o decizie sau o muncă în afara codului, la Kredsløb).

## Pe scurt

| Domeniu | Evaluare | Stare |
|---|---|---|
| Scop: diagnoza unui contor la cerere, doar citire | verde | Îndeplinit |
| Kamstrup: câte un contor, cel mult o cerere la 5 s, fără scraping | verde | Îndeplinit |
| HTTP 200 nu e o măsurătoare nouă (referință + amprentă) | verde | Îndeplinit |
| Receptoarele altor proprietari nu decid niciodată rezultatul | roșu cu registrul gol | **Făcut**: fail closed |
| Proprietar și `active` explicite în registru | galben | **Făcut** în aplicație; exportul e **Decizie** |
| Intrarea (seria contorului) validată și codificată în URL | verde | Îndeplinit |
| DOM/XSS: doar text, niciodată HTML | verde/galben | **Făcut**: etichetele hărții ca text, CSP și pe GitHub Pages |
| Service worker-ul nu păstrează date RF | verde | Îndeplinit |
| Date pe telefon: păstrare | galben | **Făcut**: limite în aplicație; cifrele sunt **Decizie** |
| Poze: ce se poate fotografia | galben | **Făcut**: regula apare în aplicație; politica e **Decizie** |
| OpenStreetMap (hartă, căutare adresă) | galben | **Decizie** |
| Bookmark-ul li (rulează în VVS-dialog) | galben | **Făcut** parțial; rămâne un risc, vezi mai jos |
| Codul pe un cont GitHub personal | galben/roșu | **Decizie**: Azure Repos ca sursă |
| Găzduire cu Entra ID (rolul `montor`) | verde | Pregătit (`staticwebapp.config.json`); **Decizie** |
| Pragurile RSSI −80 / −95 / −110 dBm | provizorii | Neschimbate până la date din teren |
| Dependențe (Leaflet, jsQR, qrcode, fără npm) | verde | Îndeplinit |

## Schimbat în v0.25

### 1. Fail closed: fără registru, fără rezultat

Înainte: fără registru încărcat, orice receptor care auzea contorul conta ca al Kredsløb. Un
concentrator puternic al altei firme putea face o instalare proastă să pară bună.

Acum:

- Fără registru **nu pornește nici măsurătoarea, nici verificarea**. Kamstrup nici nu e întrebat.
  Montorul vede (în daneză): *„Kredsløbs koncentratorregister er ikke indlæst … målingen kan ikke
  godkendes. Indlæs registret (QR-kode) på startskærmen."* Cardul registrului de pe ecranul de start
  spune același lucru.
- Un concentrator contează în rezultat doar dacă e **în registru, activ și al Kredsløb**:
  - `active` = 0 / false / nej / no: nu contează niciodată;
  - o coloană `Ownership` / `Owner` / `Ejer` / `Ejerskab`, dacă există, trebuie să spună Kredsløb
    (merge și „Kredslob", „Kredsløb A/S"). Orice alt proprietar nu contează niciodată;
  - fără coloana de proprietar, toată lista e socotită a Kredsløb, ca înainte. Aplicația o spune pe
    ecranul de start.
- Receptoarele altor proprietari rămân doar în jurnalul sesiunii, marcate ca străine; nu devin
  niciodată principal sau rezervă și nu apar ca ale noastre.
- Codul QR al registrului duce și coloana de proprietar, deci telefonul colegului primește aceleași
  reguli.
- Modul demonstrativ (simulator) merge în continuare fără registru, pentru instruire.
- Serverul opțional (`backend/`) aplică aceeași regulă în modul real.

Teste: `tests-js/engine.test.js` (fără registru, alt proprietar la −67 dBm față de al nostru la
−91 dBm, inactiv, copie prin QR, demo) și `backend/tests/test_workflow.py`.

### 2. li primește lucru doar de la LinkIQ

li (bookmark-ul) rulează în VVS-dialog cu sesiunea montorului. Acum:

- ia rapoarte și texte de la fila care l-a deschis doar dacă e LinkIQ (nume exacte:
  `valentinstm.github.io`, `*.kredslob.dk` și calculatorul acesta pentru teste);
- trimite rezultatele înapoi doar la acel LinkIQ, niciodată la o pagină oarecare;
- folosește adresa din „Tilbage til LinkIQ" doar dacă e o adresă LinkIQ.

li nu șterge niciodată nimic în VVS-dialog: caută cazul, citește fișierele, urcă raportul și scrie
Ny aktivitet cu statusul, doar când montorul îl apasă.

### 3. Doar text pe hartă

Etichetele hărții (nume site, adresă, semnal) erau date la Leaflet ca text pe care îl scrie ca HTML.
Un registru cu HTML într-un nume ar fi putut pune cod în pagină. Acum etichetele sunt text simplu.
Restul era deja scris cu `textContent`; aplicația nu folosește `innerHTML`.

### 4. Content-Security-Policy pe orice găzduire

Configurația Azure avea deja o politică strictă. GitHub Pages nu poate trimite antete, așa că aceeași
politică stă acum în `index.html` ca etichetă meta: scripturi doar din aplicație; rețea doar spre
aplicație, `check.kamstrup.com` și `nominatim.openstreetmap.org`; imagini și de la
`tile.openstreetmap.org`; fără pluginuri, fără formulare spre alte site-uri. Un test în browser rulează
toate funcțiile (hartă, căutare adresă, QR, cameră, citirea contorului, PDF, VVS-dialog) și nu găsește
nicio încălcare. Versiunea într-un singur fișier (`dist/linkiq.html`) are scripturile incluse, deci nu
are această etichetă. Azure primește și `Strict-Transport-Security`.

### 5. Păstrarea datelor pe telefon

| Date | Se păstrează |
|---|---|
| Sesiunile de măsurare | 365 de zile, cel mult 200 |
| Pozițiile salvate ale contoarelor (doar coordonate) | 365 de zile |
| Pozele cu instalația dintr-o sesiune neterminată | 30 de zile |
| Lista VVS: intrările trimise și fișierele lor | 7 zile |
| Lista VVS: intrările netrimise | până se trimit sau se șterg (ca să nu se piardă niciun caz) |

Cifrele sunt setări (`keepSessionsDays`, `keepPositionsDays` în `engine.js`, `PHOTO_KEEP_DAYS` în
`app.js`) și se schimbă când Kredsløb decide alte valori. Butonul „Slet de gemte målinger" șterge în
continuare totul deodată. Rapoartele salvate ca fișiere (Descărcări sau dosarul ales) sunt în afara
aplicației.

### 6. Regula pentru poze în aplicație

Cardul cu pozele instalației spune: *„Kun udstyret og installationen: ingen personer, papirer eller
kundens personlige ting."* (doar echipamentul și instalația: fără persoane, acte sau lucruri
personale ale clientului).

## Îndeplinit (nu trebuie schimbat)

- **Doar citire la Kamstrup**; o cerere pentru contorul scris sau scanat de montor; cache de 5 s pe
  contor (test: zece cereri în 5 s dau una singură).
- **Referință și amprentă** (`serie | oră | RSSI`): imaginea de dinainte de CALL nu e niciodată o
  măsurătoare (test).
- **Asocierea nu se ghicește**: site necunoscut = `REVIEW`, lipsă = `MISSING_LOCATION`.
- **Distanța nu decide**; decide măsurătoarea radio.
- **Redundanța**: `PRIMARY`, `SAME_SITE`, `DISTINCT_SITE`, `UNKNOWN_SITE`; se preferă alt site.
- **Fără trackere, analytics sau încărcări ascunse**; bibliotecile sunt fișiere locale.
- **Service worker-ul** păstrează doar aplicația; Kamstrup și alte site-uri nu se păstrează niciodată.
- **Seria contorului** verificată cu `^[0-9A-Za-z]{4,20}$` și codificată în URL.

## Decizii pentru Kredsløb

1. **Sursa și găzduirea.** Azure Repos devine sursa oficială, iar publicarea se face în Azure Static
   Web Apps cu Entra ID și rolul `montor` (configurația e gata în
   `frontend/staticwebapp.config.json`, pipeline-ul în `azure-pipelines.yml`). GitHub devine o oglindă
   sau se închide. Azi codul aplicației (fără registru) e public pe GitHub Pages. Când se știe adresa
   din Azure, numele exact se adaugă în `LIQ_ORIGIN` din `tools/vvs/bookmark.src.js` (un nume
   `*.kredslob.dk` e deja permis).
2. **Exportul registrului.** Lista concentratoarelor exportată cu coloanele `serialNumber`,
   `siteCode`, `active`, `Ownership` (plus lista site-urilor cu coordonate). Registrul nu intră
   niciodată într-un depozit de cod; circulă ca cod QR sau fișier.
3. **Furnizorul hărții.** OpenStreetMap vede ce bucăți de hartă încarcă un telefon (zona din jurul
   contorului) și, la căutare, adresa scrisă. Variante: se acceptă (fără date personale, fără nume de
   clienți), Azure Maps (cere o cheie legată de adresa Kredsløb) sau se oprește căutarea după adresă.
4. **Cifrele de păstrare** (tabelul de mai sus) și **politica pozelor** (inclusiv cât rămân rapoartele
   și pozele în VVS-dialog, după regulile VVS-dialog).
5. **Kamstrup.** Confirmare scrisă de la Kamstrup că READy Device Check poate fi folosit așa (câte un
   contor, cel mult o cerere la 5 s).
6. **Pragurile.** −80 / −95 / −110 dBm și 6 dB rămân provizorii până sunt comparate cu cât de complete
   sunt de fapt datele orare (rapoartele de vizită din teren).

## li: riscul rămas și soluția

Bookmark-ul scurt (încărcătorul) ia codul li din numele filei, din fila care a deschis VVS-dialog sau
din ce a salvat înainte, fără să verifice cine l-a scris. O pagină rău intenționată care deschide
VVS-dialog în aceeași filă ar putea deci planta cod, care ar rula în VVS-dialog **dacă montorul apasă
apoi li**. Codul li complet (care vine din LinkIQ și se actualizează singur) e deja protejat;
încărcătorul nu, pentru că stă în bookmark-ul fiecărui telefon.

Soluția: codul li semnat. La construire, LinkIQ îl semnează cu o cheie privată păstrată de IT-ul
Kredsløb (secret în pipeline, niciodată în depozit); încărcătorul are cheia publică și rulează doar cod
semnat corect. Asta cere **un bookmark nou pe fiecare telefon, o singură dată**, deci se face odată cu
mutarea în Azure. Până atunci: VVS-dialog se deschide doar din LinkIQ sau din bookmark-ul „Kredsløb",
iar li se apasă doar în VVS-dialog deschis așa.

Scriptul Tampermonkey (doar PC) cere aprobarea IT înainte de folosire.

## Cum s-a verificat

- `node --test tests-js/engine.test.js tests-js/lcd.test.js` (motorul, inclusiv fail closed, și
  citirea afișajului)
- `python -m pytest backend/tests` (modul server, inclusiv fail closed)
- teste în browser pentru tot fluxul, li pe o copie a VVS-dialog și un test CSP care rulează toate
  funcțiile și cere zero încălcări
- aceiași pași pe versiunea publicată, înainte și după, cu rezultate identice
