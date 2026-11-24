# LinkIQ Field Assistant – short guide for installers

[Dansk](../VEJLEDNING_DA.md) · **English**

The app's screens are in Danish (or Romanian); the button names below are the Danish ones.

1. Open the app. If a yellow box **Før du går i gang** (before you start) shows at the top, tap **Tillad kamera** and/or **Tillad at gemme i mappen** (the camera is asked once; the folder at every start). Scan the meter's QR code, or type the meter number. Enter your name.
2. Position is optional: tap **GPS** or **Vælg på kort** (pick on map).
3. Tap **Start** and choose **Antenne: Intern or Ekstern** – the CALL button stays locked until you do. **Intern:** one measurement, no rotation (shown as one circle). **Ekstern:** choose **Drejning (4 felter)** (rotation) or **Én position** (one position: screwed-on antenna, or the place the site engineer points at – one CALL, instant answer). For rotation, tap a sector to leave it out (e.g. the antenna would hit the wall). Then press **CALL** on the meter and confirm in the app when CALL shows on the display.
4. **Vent – flyt ikke antennen** (wait, do not move the antenna) while the app measures. It goes on as soon as the concentrators that regularly hear the meter have answered (otherwise after one cycle of about 35 s). Once a reading has come, **Videre med det, der er kommet** (go on with what has arrived) is available. During the rotation, **Spring felt X over** (skip sector X) is always available.
5. Turn the antenna to the next sector when the app asks (sectors left out are skipped).
6. **Tilbage til det grønne felt** (back to the green sector). Choose fine-tuning: move the antenna a little at a time and hold it still until the next reading shows (about every 20–30 seconds). If the number gets weaker, go back.
7. Fix the antenna, press **CALL** again and confirm. The app compares the final reading with the best one.
8. Fill in **Montage** (installation; can be done while the app measures): where the meter is, internal or external antenna, and where the antenna is. Choose basement or floor first, then the level.
9. Choose the result, add any remarks and tap **Gem resultatet** (save the result).
10. Optional: **Målerstande** (meter readings). Show E1 on the meter, tap the camera next to E1 and keep the whole display inside the frame. When the number is read safely, the phone vibrates and the value appears in the field. Check it against the display and correct it if wrong. Repeat for V1, operating hours (driftstimer), E8 and E9. Other registers: open **Andre registre** and tick the ones you want. Glare: tilt the phone a little. Dark room: tap **Lygte** (torch), but avoid the light reflecting in the glass. Cannot be read: tap **Gem billedet, jeg skriver selv værdien** and type the value.
11. Tap **Fotografér antennen** first (saved as `<meter>_antenne.jpg` with the measurement on the picture), then **Hent rapporten (PDF)** (saved as `<meter>.pdf`, with the photo on page 2). Before the first report the app asks once whether the meter readings should be included.
12. Tap **Åbn VVS-dialog**. The app copies the meter number and opens VVS-dialog. Sign in if asked.
13. Type **li** in the address bar in VVS-dialog and choose the line with the star. The meter's open case opens. Tap **+** next to **Dokumenter** and choose the report.

VVS-dialog opens without an address bar? Tap **⋮** and choose **Open in Chrome**.

## The registry (sites and concentrators) by QR code

Work phones may not save files from Teams or mail, so the registry travels as a QR code:

1. A colleague who has the registry in the app (e.g. on a PC) taps **Lav en QR-kode af registret til kolleger** (make a QR code of the registry) in the card *Data på denne enhed*, and shows the code on screen or prints it.
2. You tap **Scan registret fra QR-kode** and hold the phone 20–30 cm from the code.
3. If you got the code as a picture (e.g. a screenshot), tap **Vælg et billede med QR-koden** (choose a picture).

The app says *Register læst fra QR-koden fra …* with the number of sites and concentrators. The QR code holds the concentrators' locations: share it internally only.

## The li bookmark (created once)

1. In the app: tap **Opret bogmærket li** on the start screen, then **Kopiér koden** (copy the code).
2. In Chrome: open any page, tap **⋮** and the star.
3. Tap **Edit**. Name: `li`. Delete the address and paste the code.
4. Check that the address starts with `javascript:` – otherwise type it in front.

The bookmark only works from the address bar, not from the bookmark list. It searches for the meter number and opens the case that is not *Afsluttet* (finished) or *Lukket* (closed). If there are several open cases, you choose. It does not upload, change or delete anything.

Switch language with the **RO/DA** button at the top.

## Report folder

The browser forgets the folder permission when the app is closed. The app asks only when you tap the
button in the yellow box at start-up (or in the report box) – never by itself and never while a report
is being saved. Without permission the report goes straight to **Downloads**. If Chrome offers "Allow on
every visit", choose it. To use no folder at all: *Rapportmappe* → **Brug ingen mappe – gem altid i Overførsler**.
