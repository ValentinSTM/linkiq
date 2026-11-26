# Ideer og planlagte test

**Dansk** · [English](en/IDEAS.md) · [Română](ro/IDEI.md) · Ikke påbegyndt. Noteret 18.11.2026.

## 1. Døgntest: registrerer alle koncentratorer den samme kontakt?

**Spørgsmål.** Statuskontrollen viser for hver koncentrator kun den *seneste* kontakt med måleren
(`TimestampUtcToDevice`). Vi ved ikke, om en koncentrator, der hører måleren, altid registrerer
kontakten, eller om kun den koncentrator, måleren er tilknyttet, opdaterer tidsstemplet. I det
sidste tilfælde kan „lejlighedsvis kontakt" skjule en god reserveforbindelse, og vurderingen af
redundans bliver forkert.

**Hvad vi ved (måler 84751487, 18.11.2026).**

- 73475312 og 73495179 har kontakt 07:54:19 og 07:54:20 UTC: det samme telegram registreret af to
  koncentratorer. Ved CALL-testen 12.11.2026 svarede ca. 25 koncentratorer inden for et halvt minut.
  Flere koncentratorer kan altså registrere den samme kontakt.
- Efter 07:54 har kun 73475313 (−119 dBm) kontakt. De andre ligger på −127…−130 dBm, tæt på
  grænsen for modtagelse. Om de ikke hørte måleren, eller ikke registrerede kontakten, kan ikke
  afgøres ud fra ét øjebliksbillede.
- `TimestampUtcFromDevice` og `RssiFromDevice` er tomme for alle koncentratorer: vi har kun den ene
  retning.
- Kamstrup viser den samme koncentrator flere gange i `Links`, med ældre registreringer (57–61 dage).
  Betydningen er ukendt. Appen viser kun den seneste (v0.15).

**Test.** En separat side (ikke i montørappen), der står åben på en pc i 24 timer:

- spørger Kamstrup for 5–10 udvalgte målere hvert 10. minut (≈ 1 forespørgsel i minuttet), både
  målere med god dækning og målere i svære områder;
- gemmer hver ændring af en koncentrators tidsstempel og signal;
- eksporterer CSV og et resumé pr. måler.

**Sådan læses resultatet.**

| Observation | Betydning |
|---|---|
| Ved hver udsendelse opdateres flere koncentratorer i samme sekund | alle registrerer; „lejlighedsvis" = reel svag modtagelse |
| Ved hver udsendelse opdateres kun én, altid den samme; de andre kun, når den første mangler | kun den aktive forbindelse registreres; „lejlighedsvis" kan skjule en god reserve |
| Antal udsendelser i timen og hvor mange hver koncentrator fanger | den reelle stabilitet time for time |

**Forudsætning.** En pc, der kan stå tændt et døgn. Siden bruger den samme direkte adgang til
Kamstrup som appen, så den kræver ingen server.

**Spørgsmål til Kamstrup (kan sendes med det samme).**

> Når en LinkIQ-måler sender, registrerer alle koncentratorer, der modtager telegrammet, så
> kontakten (TimestampUtcToDevice opdateres)? Eller kun den koncentrator, måleren er tilknyttet?
> Og hvad betyder det, når den samme koncentrator står flere gange i Links med forskellige
> tidsstempler?

## 2. Historik over statuskontroller

Gem resultatet af hver statuskontrol pr. måler, så appen kan vise „kontakt inden for den seneste time
ved 3 af 3 kontroller". Ét øjebliksbillede beviser ikke stabilitet. Kræver, at data gemmes på
telefonen; afventer beslutning.
