# Android: funcționalitate completă fără găzduire

Browserul dă acces la GPS și la camera live doar paginilor de la o adresă sigură. `https://…` este
una; `http://localhost` este cealaltă. Un fișier deschis direct din memoria telefonului nu este.

Deci pe telefon rulează un mic server de fișiere, iar aplicația se deschide din Chrome la
`http://localhost`. Serverul doar livrează fișierul `linkiq.html`; măsurarea rămâne în pagină.

## Pași

1. Instalează din Google Play o aplicație de tip „static HTTP server”. Exemplu: **Simple HTTP Server**
   (pachet `com.phlox.simpleserver`). Netestat de noi pe un telefon real.
2. Creează pe telefon un dosar, de exemplu `Download/linkiq`, și copiază în el `dist/linkiq.html`,
   redenumit `index.html`.
3. În aplicația-server alege acel dosar ca rădăcină, lasă portul propus (de regulă 8080) și pornește serverul.
4. În Chrome deschide `http://localhost:8080/`. Adresa trebuie să fie `localhost`, nu adresa IP a
   telefonului: doar `localhost` este considerată sigură.
5. La prima folosire, permite accesul la locație și la cameră.
6. Meniul Chrome → „Adaugă pe ecranul principal”. Aplicația apare cu iconiță.

Serverul trebuie să fie pornit când se deschide aplicația. Multe aplicații-server au opțiune de pornire
automată.

## Ce se câștigă față de fișierul deschis direct

| | Fișier deschis direct | `http://localhost` sau HTTPS |
|---|---|---|
| Măsurare, raport, fotografie cu rezultat | da | da |
| Seria din QR | prin fotografie | cameră live |
| Poziție | aleasă pe hartă | GPS automat sau hartă |
| Registrul și sesiunile se păstrează | nesigur | da |
| Iconiță pe ecranul principal | nu | da |

## iPhone

Pe iPhone, soluția practică este o adresă HTTPS (aceeași `linkiq.html` pe orice găzduire de fișiere
statice). Aplicațiile-server pentru iOS există, dar sistemul le oprește când trec în fundal.

## Alternativa fără nimic de instalat

Publicarea `linkiq.html` la o adresă HTTPS dă același rezultat pe Android și iPhone, fără server pe
telefon. Fișierul nu conține date: registrul se încarcă pe fiecare telefon.
