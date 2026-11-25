# LinkIQ Field Assistant – kort vejledning til montøren

**Dansk** · [English](en/GUIDE.md)

1. Åbn appen. Står der et gult felt **Før du går i gang** øverst, så tryk **Tillad kamera** og/eller **Tillad at gemme i mappen** (kameraet spørges der om én gang; mappen ved hver opstart). Scan målerens QR-kode, eller indtast målernummeret. Skriv dit navn.
2. Position er valgfri: tryk **GPS**, eller **Vælg på kort**. På kortet kan du trykke ved måleren, skrive koordinater eller skrive adressen (fx *Søndergade 1, 8000 Aarhus C*) og trykke **Søg**. Adressen slås op i OpenStreetMap; kontrollér punktet på kortet.
3. Tryk **Start**, og vælg **Antenne: Intern eller Ekstern** – CALL-knappen er låst, indtil du har valgt. **Intern:** én måling, ingen drejning (vises som én cirkel). **Ekstern:** vælg **Drejning (4 felter)** eller **Én position** (fastskruet antenne, eller stedet ingeniøren peger på: ét CALL og svar med det samme). Ved drejning: tryk på et felt for at springe det over, fx hvis antennen ville ramme væggen. Tryk derefter **CALL** på måleren, og bekræft i appen, når CALL vises i displayet.
4. **Vent – flyt ikke antennen**, mens appen måler. Appen går videre, så snart de koncentratorer, der plejer at høre måleren, har svaret (ellers efter én cyklus på ca. 35 s). Er der kommet en måling, kan du trykke **Videre med det, der er kommet**. Under drejningen kan du altid trykke **Spring felt X over**.
5. Drej antennen til næste felt, når appen beder om det (felter, du har sprunget over, springes over).
6. **Tilbage til det grønne felt.** Vælg finjustering: flyt antennen lidt ad gangen, og hold den stille, indtil næste måling vises (ca. hvert 20.–30. sekund). Er tallet svagere, så gå tilbage.
7. Fastgør antennen, tryk **CALL** igen, og bekræft. Appen sammenligner slutmålingen med den bedste måling.
8. Udfyld **Montage** (kan gøres, mens appen måler): hvor måleren sidder, og – for en ekstern antenne – hvor antennen sidder. Vælg kælder eller etage først, derefter niveauet.
9. Vælg resultat, skriv eventuelle bemærkninger, og tryk **Gem resultatet**.
10. Valgfrit: **Målerstande**. Vis E1 på måleren, tryk på kameraet ved E1, og hold hele displayet inde i rammen. Når tallet er læst sikkert, vibrerer telefonen, og værdien står i feltet. Kontrollér tallet mod displayet, og ret det, hvis det er forkert. Gentag for V1, driftstimer, E8 og E9. Andre registre: åbn **Andre registre**, og sæt flueben ved dem, du vil have med. Ved genskin: vip telefonen lidt. I mørke: tryk **Lygte**, men undgå, at lyset spejler sig i glasset. Kan tallet ikke læses: tryk **Gem billedet, jeg skriver selv værdien**.
11. **Billeder af installationen** – ved hver installation, uanset antenne: tryk **Ved montage** og **Ved idriftsættelse**, og fotografér hele installationen (måleren, rørene, antennen og omgivelserne). Op til 6 billeder; hvert får målernummer, tidspunkt og montagedata skrevet på. Kortet kan bruges, mens appen måler. Billederne kommer med i PDF-rapporten som historik og dokumentation for korrekt montage. Mangler de, spørger appen én gang, før rapporten gemmes.
12. Ekstern antenne: tryk **Fotografér antennen** (gemmes som `<målernummer>_antenne.jpg` med måledata på billedet). Vælg derefter resultat og status for VVS-dialog, og tryk **Hent rapporten (PDF)** (gemmes som `<målernummer>.pdf`, med antennefotoet og installationsbillederne på de følgende sider). Inden den første rapport spørger appen én gang, om målerstandene skal med.
13. Tryk **Send til VVS-dialog**, og tryk **li** i VVS-dialog. Rapporten, teksten i Ny aktivitet og status kommer selv på sagen. Fanen **VVS** viser, hvad der er sendt, og hvad der venter.

**Glemt at sende en dag?** Åbn fanen **VVS**, og tryk **Søg efter rapporter i mappen** (pc) eller **Tilføj rapporter fra filer** (telefon: vælg PDF'erne i Overførsler). Appen finder én rapport pr. måler (den nyeste) ud fra målernummeret i filnavnet; rapporter, der allerede er på listen eller på en sag, er ikke markeret. Vælg resultat og status på hver, og send. Uden resultat lægger li kun filen på sagen.

Åbner VVS-dialog uden adresselinje? Tryk **⋮**, og vælg **Åbn i Chrome**.

## Registret (sites og koncentratorer) via QR-kode

Arbejdstelefonen må ikke gemme filer fra Teams eller mail. Registret kommer derfor som en QR-kode:

1. En kollega med registret i appen (fx på pc'en) trykker **Lav en QR-kode af registret til kolleger** i kortet *Data på denne enhed* og viser koden på skærmen eller udskriver den.
2. Du trykker **Scan registret fra QR-kode** og holder telefonen 20–30 cm fra koden.
3. Har du fået koden som billede (fx et skærmbillede), så tryk **Vælg et billede med QR-koden**.

Appen skriver *Register læst fra QR-koden fra …* med antal sites og koncentratorer. QR-koden indeholder koncentratorernes placering: del den kun internt.

## Bogmærket li (oprettes én gang)

1. I appen: tryk **Opret bogmærket li** på startskærmen, og tryk **Kopiér koden**.
2. I Chrome: åbn en vilkårlig side, tryk **⋮** og stjernen.
3. Tryk **Rediger**. Navn: `li`. Slet adressen, og indsæt koden.
4. Tjek, at adressen begynder med `javascript:` – ellers skriv det foran.

Bogmærket virker kun fra adresselinjen, ikke fra bogmærkelisten. Det søger på målernummeret og åbner den sag, der ikke er *Afsluttet* eller *Lukket*. Er der flere åbne sager, vælger du selv. Det uploader, ændrer og sletter ikke noget.

Sprog skiftes med knappen **RO/DA** øverst.

## Rapportmappen

Browseren glemmer adgangen til rapportmappen, når appen lukkes. Appen spørger derfor kun, når du selv
trykker på knappen i det gule felt ved opstart (eller i rapportboksen) – aldrig af sig selv og aldrig
midt i, at en rapport gemmes. Er der ingen adgang, gemmes rapporten straks i **Overførsler**. Tilbyder
Chrome „Tillad ved hvert besøg“, så vælg det. Vil du slet ikke bruge en mappe: *Rapportmappe* →
**Brug ingen mappe – gem altid i Overførsler**.
