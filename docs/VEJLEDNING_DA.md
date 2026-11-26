# LinkIQ Field Assistant – kort vejledning til montøren

**Dansk** · [English](en/GUIDE.md)

**Navigation.** Nederst er der altid fem faner: **Måling** (start eller den måling, der er i gang),
**Modtagere**, **Kort**, **Rapporter** (det røde tal er rapporter, der venter på VVS-dialog) og **Mere**
(register, rapportmappe, bogmærket li, startbillede, feedback, sprog). Telefonens tilbage-knap går et skridt tilbage
i appen. Registret, sletteknapperne og demotilstanden ligger under **Mere**; sletteknapperne er gemt
under **Avanceret**, så de ikke trykkes ved et uheld.

1. Åbn appen. Står der et gult felt **Før du går i gang** øverst, så tryk **Tillad kamera**, **Tillad position** og/eller **Tillad at gemme i mappen** (kamera og position spørges der om én gang; mappen ved hver opstart). Står der **Registret mangler**, så scan registrets QR-kode først: uden registret kan der ikke måles. Scan målerens QR-kode, eller indtast målernummeret. Skriv dit navn.
2. Position: er GPS tilladt, hentes den af sig selv ved start og for hver ny måler. Er GPS slået fra (fx på en pc, hvor firmaets politik slår placering fra), så tryk **Adresse eller kort**, skriv adressen (fx *Søndergade 1, 8000 Aarhus C*), og tryk **Søg**, eller tryk på kortet ved måleren. Adressen slås op i OpenStreetMap; kontrollér punktet. Adressen skrives i feltet **Adresse (forbrugssted)** og i rapporten. Kontrollér selv på stedet, at du er på adressen fra sagen i VVS-dialog (lejlighed, etage): adresser skrives ofte forskelligt, så det kontrolleres ikke automatisk. Forklaringen under kortet viser farverne og linjerne: grøn = godt signal, orange = marginalt, rød = svagt, grå prikket = ingen kontakt i over 8 timer; tyk hel linje = primær modtager, stiplet = de øvrige. Uden position vises koncentratorerne stadig på kortet, men uden linjer og afstande; positionen kan også angives senere med **Målerens position: adresse eller kort** under **Kort**.
3. Tryk **Start**, og vælg **Antenne: Intern eller Ekstern** – CALL-knappen er låst, indtil du har valgt. **Intern:** én måling, ingen drejning (vises som én cirkel). **Ekstern:** vælg **Drejning (4 felter)** eller **Én position** (fastskruet antenne, eller stedet ingeniøren peger på: ét CALL og svar med det samme). Ved drejning: tryk på et felt for at springe det over, fx hvis antennen ville ramme væggen. Tryk derefter **CALL** på måleren, og bekræft i appen, når CALL vises i displayet.
4. **Vent – flyt ikke antennen**, mens appen måler. Appen går videre, så snart de koncentratorer, der plejer at høre måleren, har svaret (ellers efter én cyklus på ca. 35 s). Er der kommet en måling, kan du trykke **Videre med det, der er kommet**. Under drejningen kan du altid trykke **Spring felt X over**.
5. Drej antennen til næste felt, når appen beder om det (felter, du har sprunget over, springes over).
6. **Tilbage til det grønne felt.** Vælg finjustering: flyt antennen lidt ad gangen, og hold den stille, indtil næste måling vises (ca. hvert 20.–30. sekund). Er tallet svagere, så gå tilbage.
7. Fastgør antennen, tryk **CALL** igen, og bekræft. Appen sammenligner slutmålingen med den bedste måling.
8. Udfyld **Montage** (kan gøres, mens appen måler): hvor måleren sidder, og – for en ekstern antenne – hvor antennen sidder. Vælg kælder eller etage først, derefter niveauet.
9. Vælg resultat, skriv eventuelle bemærkninger, og tryk **Gem resultatet**.
10. Valgfrit: **Målerstande**. Vis E1 på måleren, tryk på kameraet ved E1, og hold hele displayet inde i rammen, ca. 15 cm væk – for tæt på kan kameraet ikke fokusere. Brug zoom med **+** og **−** (appen starter på 2×, når telefonens kamera kan zoome). Når tallet er læst sikkert, vibrerer telefonen, og værdien står i feltet. Kontrollér tallet mod displayet, og ret det, hvis det er forkert. Gentag for V1, driftstimer, E8 og E9. Andre registre: åbn **Andre registre**, og sæt flueben ved dem, du vil have med. Ved genskin: vip telefonen lidt, eller tryk **☀ −**. I mørke: tryk **☀ +** (lysere billede) eller **Lygte**, men undgå, at lyset spejler sig i glasset. Knapperne vises kun, hvis telefonens kamera tillader det. Du kan også tage billedet med telefonens Kamera-app (blitz, nattilstand) og trykke **Vælg et billede fra galleriet**. Kan tallet ikke læses: tryk **Gem billedet, jeg skriver selv værdien**.
11. **Billeder af installationen** – ved hver installation, uanset antenne: tryk **Ved montage** og **Ved idriftsættelse**, og fotografér hele installationen (måleren, rørene, antennen og omgivelserne). Tryk også **Vandvarmer / unit (typeskilt)**, så det kan ses, hvilken unit der sidder på adressen. Op til 8 billeder; hvert får målernummer, tidspunkt og montagedata skrevet på. Dårligt lys: tag billedet med telefonens Kamera-app (blitz eller nattilstand), og vælg det fra galleriet med linkene i kortet. Kortet kan bruges, mens appen måler. Billederne kommer med i PDF-rapporten som historik og dokumentation for korrekt montage. Mangler de, eller mangler billedet af vandvarmer / unit, spørger appen én gang, før rapporten gemmes.
12. **Installationen (El og syn)**: vælg **Anlæg** (Direkte, Indirekte, Direkte med bladesløjfe), **Vandvarmer** (Veksler, Beholder, Unit), ved en unit fabrikatet (APV, Gemina Termix, Hoval, Metrotherm, Redan, Wavin), eventuelt **Model**, samt **Hovedhaner lukket?** og **Plomberet?**. Oplysningerne kommer i rapporten under *El og syn* og som én linje i Ny aktivitet, så der ikke skal udfyldes en separat El og syn-formular. *3 tælleværker aflæst* (E1, V1, driftstimer) og *Foto* udfylder appen selv.
13. Ekstern antenne: tryk **Fotografér antennen** (gemmes som `<målernummer>_antenne.jpg` med måledata på billedet). Vælg derefter resultat og status for VVS-dialog, og tryk **Hent rapporten (PDF)** (gemmes som `<målernummer>.pdf`, med antennefotoet og installationsbillederne på de følgende sider). Inden den første rapport spørger appen én gang, om målerstandene skal med.
14. Tryk **Send til VVS-dialog**, og tryk **li** i VVS-dialog. Rapporten (PDF og billede), alle installationsbillederne, antennebilledet, teksten i Ny aktivitet og status kommer selv på sagen. Fanen **Rapporter** viser, hvad der er sendt, og hvad der venter.
15. **Før du går**, nederst i rapportboksen: ✓ ved rapporten, billederne, målerstandene og VVS-dialog. Tryk på en linje for at se rapporten eller billederne i appen (bladr med pilene eller ved at stryge), og luk med **Luk** eller telefonens tilbage-knap. Rapporter og billeder åbnes altid inde i appen, også fra listen under **Rapporter** og fra rapportmappen, så du aldrig skal lukke appen for at komme tilbage.

**Glemt at sende en dag?** Åbn fanen **Rapporter**, og tryk **Søg efter rapporter i mappen** (pc) eller **Tilføj rapporter fra filer** (telefon: vælg PDF'erne i Overførsler). Appen finder én rapport pr. måler (den nyeste) ud fra målernummeret i filnavnet; rapporter, der allerede er på listen eller på en sag, er ikke markeret. Vælg resultat og status på hver, og send. Uden resultat lægger li kun filen på sagen.

Åbner VVS-dialog uden adresselinje? Tryk **⋮**, og vælg **Åbn i Chrome**.

## Registret (sites og koncentratorer) via QR-kode

Arbejdstelefonen må ikke gemme filer fra Teams eller mail. Registret kommer derfor som en QR-kode:

1. En kollega med registret i appen (fx på pc'en) trykker **Lav en QR-kode af registret til kolleger** under **Mere** › *Register og data* og viser koden på skærmen eller udskriver den.
2. Du trykker **Scan registret (QR-kode)** på startskærmen (eller under **Mere**) og holder telefonen 20–30 cm fra koden.
3. Har du fået koden som billede (fx et skærmbillede), så tryk **Vælg et billede med QR-koden**.

Appen skriver *Register læst fra QR-koden fra …* med antal sites og koncentratorer. QR-koden indeholder koncentratorernes placering: del den kun internt.

## Bogmærket li (oprettes én gang)

1. I appen: tryk **Opret bogmærket li** under **Mere**, og tryk **Kopiér koden**.
2. I Chrome: åbn en vilkårlig side, tryk **⋮** og stjernen.
3. Tryk **Rediger**. Navn: `li`. Slet adressen, og indsæt koden.
4. Tjek, at adressen begynder med `javascript:` – ellers skriv det foran.

Bogmærket virker kun fra adresselinjen, ikke fra bogmærkelisten. Det søger på målernummeret og åbner den sag, der ikke er *Afsluttet* eller *Lukket*. Er der flere åbne sager, vælger du selv. Det uploader, ændrer og sletter ikke noget.

Sprog skiftes under **Mere** › *Sprog*.

## Rapportmappen

Browseren glemmer adgangen til rapportmappen, når appen lukkes. Appen spørger derfor kun, når du selv
trykker på knappen i det gule felt ved opstart (eller i rapportboksen) – aldrig af sig selv og aldrig
midt i, at en rapport gemmes. Er der ingen adgang, gemmes rapporten straks i **Overførsler**. Tilbyder
Chrome „Tillad ved hvert besøg“, så vælg det. Vil du slet ikke bruge en mappe: *Rapportmappe* →
**Brug ingen mappe – gem altid i Overførsler**.
