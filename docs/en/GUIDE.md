# LinkIQ Field Assistant – short guide for installers

[Dansk](../VEJLEDNING_DA.md) · **English**

The app's screens are in Danish (or Romanian); the button names below are the Danish ones.

1. Open the app. Scan the meter's QR code, or type the meter number. Enter your name.
2. Position is optional: tap **GPS** or **Vælg på kort** (pick on map).
3. Tap **Start**. Put the antenna in the starting position (sector 1) and press **CALL** on the meter. Confirm in the app when CALL shows on the meter's display.
4. **Vent – flyt ikke antennen** (wait, do not move the antenna) while the app measures. It usually takes 20–40 seconds per sector.
5. Turn the antenna a quarter turn clockwise when the app asks. Repeat for all four sectors.
6. **Tilbage til det grønne felt** (back to the green sector). Choose fine-tuning: move the antenna a little at a time and hold it still until the next reading shows (about every 20–30 seconds). If the number gets weaker, go back.
7. Fix the antenna, press **CALL** again and confirm. The app compares the final reading with the best one.
8. Fill in **Montage** (installation; can be done while the app measures): where the meter is, internal or external antenna, and where the antenna is. Choose basement or floor first, then the level.
9. Choose the result, add any remarks and tap **Gem resultatet** (save the result).
10. Tap **Fotografér antennen** first (saved as `<meter>_antenne.jpg` with the measurement on the picture), then **Hent rapporten (PDF)** (saved as `<meter>.pdf`, with the photo on page 2).
11. Tap **Åbn VVS-dialog**. The app copies the meter number and opens VVS-dialog. Sign in if asked.
12. Type **li** in the address bar in VVS-dialog and choose the line with the star. The meter's open case opens. Tap **+** next to **Dokumenter** and choose the report.

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
