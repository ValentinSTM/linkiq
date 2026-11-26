# Idei și teste planificate

[Dansk](../IDEER.md) · [English](../en/IDEAS.md) · **Română** · Neîncepute. Notat 18.11.2026.

## 1. Test de 24 de ore: înregistrează toate concentratoarele același contact?

**Întrebarea.** Verificarea arată, pentru fiecare concentrator, doar *ultimul* contact cu contorul
(`TimestampUtcToDevice`). Nu știm dacă un concentrator care aude contorul înregistrează mereu
contactul, sau dacă doar concentratorul la care e legat contorul actualizează ora. În al doilea caz,
„contact ocazional" poate ascunde o legătură de rezervă bună, iar evaluarea redundanței e greșită.

**Ce știm (contorul 84751487, 18.11.2026).**

- 73475312 și 73495179 au contact la 07:54:19 și 07:54:20 UTC: aceeași telegramă înregistrată de două
  concentratoare. La testul CALL din 12.11.2026 au răspuns cam 25 de concentratoare în jumătate de
  minut. Deci mai multe concentratoare pot înregistra același contact.
- După 07:54 doar 73475313 (−119 dBm) are contact. Celelalte sunt la −127…−130 dBm, aproape de limita
  de recepție. Dacă nu au auzit contorul sau nu au înregistrat contactul nu se poate spune dintr-o
  singură imagine.
- `TimestampUtcFromDevice` și `RssiFromDevice` sunt goale la toate concentratoarele: avem doar o
  direcție.
- Kamstrup arată același concentrator de mai multe ori în `Links`, cu înregistrări mai vechi
  (57–61 de zile). Nu știm ce înseamnă. Aplicația o arată doar pe cea mai nouă (v0.15).

**Testul.** O pagină separată (nu în aplicația montorilor), lăsată deschisă pe un PC 24 de ore:

- întreabă Kamstrup despre 5–10 contoare alese la fiecare 10 minute (≈ o cerere pe minut), atât
  contoare cu acoperire bună, cât și din zone grele;
- salvează fiecare schimbare a orei și a semnalului unui concentrator;
- exportă CSV și un rezumat pe contor.

**Cum se citește rezultatul.**

| Observație | Înseamnă |
|---|---|
| La fiecare transmisie se actualizează mai multe concentratoare în aceeași secundă | toate înregistrează; „ocazional" = recepție chiar slabă |
| La fiecare transmisie se actualizează doar unul, mereu același; celelalte doar când primul lipsește | se înregistrează doar legătura activă; „ocazional" poate ascunde o rezervă bună |
| Transmisii pe oră și câte prinde fiecare concentrator | stabilitatea reală, oră cu oră |

**Condiție.** Un PC care poate sta pornit o zi. Pagina folosește același acces direct la Kamstrup ca
aplicația, deci nu cere server.

**Întrebare pentru Kamstrup (se poate trimite acum).**

> Când un contor LinkIQ transmite, înregistrează contactul toate concentratoarele care primesc
> telegrama (se actualizează TimestampUtcToDevice)? Sau doar concentratorul la care e legat contorul?
> Și ce înseamnă când același concentrator apare de mai multe ori în Links cu ore diferite?

## 2. Istoricul verificărilor

Salvarea rezultatului fiecărei verificări pe contor, ca aplicația să arate „contact în ultima oră la
3 din 3 verificări". O singură imagine nu dovedește stabilitatea. Cere păstrarea datelor pe telefon;
așteaptă o decizie.
