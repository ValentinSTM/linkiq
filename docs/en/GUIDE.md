# LinkIQ Field Assistant – short guide for installers

[Dansk](../VEJLEDNING_DA.md) · **English**

The app's screens are in Danish (or Romanian); the button names below are the Danish ones.

1. Open the app. If a yellow box **Før du går i gang** (before you start) shows at the top, tap **Tillad kamera** and/or **Tillad at gemme i mappen** (the camera is asked once; the folder at every start). Scan the meter's QR code, or type the meter number. Enter your name.
2. Position is optional: tap **GPS** or **Vælg på kort** (pick on map). On the map you can tap at the meter, type coordinates, or type the address (e.g. *Søndergade 1, 8000 Aarhus C*) and tap **Søg**. The address is looked up in OpenStreetMap; check the point on the map.
3. Tap **Start** and choose **Antenne: Intern or Ekstern** – the CALL button stays locked until you do. **Intern:** one measurement, no rotation (shown as one circle). **Ekstern:** choose **Drejning (4 felter)** (rotation) or **Én position** (one position: screwed-on antenna, or the place the site engineer points at – one CALL, instant answer). For rotation, tap a sector to leave it out (e.g. the antenna would hit the wall). Then press **CALL** on the meter and confirm in the app when CALL shows on the display.
4. **Vent – flyt ikke antennen** (wait, do not move the antenna) while the app measures. It goes on as soon as the concentrators that regularly hear the meter have answered (otherwise after one cycle of about 35 s). Once a reading has come, **Videre med det, der er kommet** (go on with what has arrived) is available. During the rotation, **Spring felt X over** (skip sector X) is always available.
5. Turn the antenna to the next sector when the app asks (sectors left out are skipped).
6. **Tilbage til det grønne felt** (back to the green sector). Choose fine-tuning: move the antenna a little at a time and hold it still until the next reading shows (about every 20–30 seconds). If the number gets weaker, go back.
7. Fix the antenna, press **CALL** again and confirm. The app compares the final reading with the best one.
8. Fill in **Montage** (installation; can be done while the app measures): where the meter is, internal or external antenna, and where the antenna is. Choose basement or floor first, then the level.
9. Choose the result, add any remarks and tap **Gem resultatet** (save the result).
10. Optional: **Målerstande** (meter readings). Show E1 on the meter, tap the camera next to E1 and keep the whole display inside the frame. When the number is read safely, the phone vibrates and the value appears in the field. Check it against the display and correct it if wrong. Repeat for V1, operating hours (driftstimer), E8 and E9. Other registers: open **Andre registre** and tick the ones you want. Glare: tilt the phone a little. Dark room: tap **Lygte** (torch), but avoid the light reflecting in the glass. Cannot be read: tap **Gem billedet, jeg skriver selv værdien** and type the value.
11. **Installation photos** – at every installation, whatever the antenna: tap **Ved montage** and **Ved idriftsættelse** and photograph the whole installation (meter, pipes, antenna and surroundings). Up to 6 photos; each gets the meter number, time and installation data written on it. The card can be used while the app measures. The photos go into the PDF report as history and proof of a correct installation. If there are none, the app asks once before the report is saved.
12. External antenna: tap **Fotografér antennen** (saved as `<meter>_antenne.jpg` with the measurement on the picture). Then choose the result and status for VVS-dialog and tap **Hent rapporten (PDF)** (saved as `<meter>.pdf`, with the antenna photo and the installation photos on the following pages). Before the first report the app asks once whether the meter readings should be included.
13. Tap **Send til VVS-dialog** and tap **li** in VVS-dialog. The report, the Ny aktivitet text and the status reach the case on their own. The **VVS** tab shows what has been sent and what is waiting.

**Forgot to send one day?** Open the **VVS** tab and tap **Søg efter rapporter i mappen** (PC) or **Tilføj rapporter fra filer** (phone: pick the PDFs in Downloads). The app finds one report per meter (the newest) from the meter number in the file name; reports already in the list or on a case are not ticked. Choose result and status on each and send. Without a result li only puts the file on the case.

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
