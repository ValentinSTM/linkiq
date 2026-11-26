# LinkIQ Field Assistant – short guide for installers

[Dansk](../VEJLEDNING_DA.md) · **English**

The app's screens are in Danish; the button names below are the Danish ones.

**Navigation.** At the bottom there are always five tabs: **Måling** (start, or the measurement in
progress), **Modtagere** (receivers), **Kort** (map), **Rapporter** (reports; the red number counts
reports waiting for VVS-dialog) and **Mere** (more: registry, report folder, the li bookmark, start picture,
feedback, language). The phone's back button goes one step back in the app. The registry, the delete buttons and
demo mode are under **Mere**; the delete buttons are tucked under **Avanceret** (advanced) so they are
not tapped by accident.

1. Open the app. If a yellow box **Før du går i gang** (before you start) shows at the top, tap **Tillad kamera**, **Tillad position** and/or **Tillad at gemme i mappen** (camera and position are asked once; the folder at every start). If **Registret mangler** (registry missing) shows, scan the registry QR code first: without the registry no measurement can be made. Scan the meter's QR code, or type the meter number. Enter your name.
2. Position: when GPS is allowed it is taken by itself at start and for every new meter. When GPS is off (e.g. on a PC where company policy turns location off), tap **Adresse eller kort** (address or map), type the address (e.g. *Søndergade 1, 8000 Aarhus C*) and tap **Søg**, or tap the map at the meter. The address is looked up in OpenStreetMap; check the point. The address goes into the **Adresse (forbrugssted)** field and the report; li compares it with the case address in VVS-dialog and asks before putting anything on a case with another address (the meter may have been mounted in the wrong flat). The legend under the map shows the colours and lines: green = good signal, orange = marginal, red = weak, grey dotted = no contact for over 8 hours; thick solid line = primary receiver, dashed = the others. Without a position the concentrators still show on the map, but without lines and distances; the position can also be set later with **Målerens position: adresse eller kort** under **Kort**.
3. Tap **Start** and choose **Antenne: Intern or Ekstern** – the CALL button stays locked until you do. **Intern:** one measurement, no rotation (shown as one circle). **Ekstern:** choose **Drejning (4 felter)** (rotation) or **Én position** (one position: screwed-on antenna, or the place the site engineer points at – one CALL, instant answer). For rotation, tap a sector to leave it out (e.g. the antenna would hit the wall). Then press **CALL** on the meter and confirm in the app when CALL shows on the display.
4. **Vent – flyt ikke antennen** (wait, do not move the antenna) while the app measures. It goes on as soon as the concentrators that regularly hear the meter have answered (otherwise after one cycle of about 35 s). Once a reading has come, **Videre med det, der er kommet** (go on with what has arrived) is available. During the rotation, **Spring felt X over** (skip sector X) is always available.
5. Turn the antenna to the next sector when the app asks (sectors left out are skipped).
6. **Tilbage til det grønne felt** (back to the green sector). Choose fine-tuning: move the antenna a little at a time and hold it still until the next reading shows (about every 20–30 seconds). If the number gets weaker, go back.
7. Fix the antenna, press **CALL** again and confirm. The app compares the final reading with the best one.
8. Fill in **Montage** (installation; can be done while the app measures): where the meter is, internal or external antenna, and where the antenna is. Choose basement or floor first, then the level.
9. Choose the result, add any remarks and tap **Gem resultatet** (save the result).
10. Optional: **Målerstande** (meter readings). Show E1 on the meter, tap the camera next to E1 and keep the whole display inside the frame, about 15 cm away – closer than that the camera cannot focus. Zoom with **+** and **−** (the app starts at 2× when the phone's camera can zoom). When the number is read safely, the phone vibrates and the value appears in the field. Check it against the display and correct it if wrong. Repeat for V1, operating hours (driftstimer), E8 and E9. Other registers: open **Andre registre** and tick the ones you want. Glare: tilt the phone a little, or tap **☀ −**. Dark room: tap **☀ +** (brighter picture) or **Lygte** (torch), but avoid the light reflecting in the glass. The buttons appear only where the phone's camera allows it. You can also take the picture with the phone's Camera app (flash, night mode) and tap **Vælg et billede fra galleriet**. Cannot be read: tap **Gem billedet, jeg skriver selv værdien** and type the value.
11. **Installation photos** – at every installation, whatever the antenna: tap **Ved montage** and **Ved idriftsættelse** and photograph the whole installation (meter, pipes, antenna and surroundings). Also tap **Vandvarmer / unit (typeskilt)** so it shows which unit is installed at the address. Up to 8 photos; each gets the meter number, time and installation data written on it. Poor light: take the photo with the phone's Camera app (flash or night mode) and pick it from the gallery with the links in the card. The card can be used while the app measures. The photos go into the PDF report as history and proof of a correct installation. If there are none, or the water heater / unit photo is missing, the app asks once before the report is saved.
12. **Installationen (El og syn)**: choose **Anlæg** (Direkte, Indirekte, Direkte med bladesløjfe), **Vandvarmer** (Veksler, Beholder, Unit), for a unit the make (APV, Gemina Termix, Hoval, Metrotherm, Redan, Wavin), optionally **Model**, and **Hovedhaner lukket?** and **Plomberet?**. They go into the report under *El og syn* and as one line in Ny aktivitet, so no separate El og syn form is needed. The app fills in *3 tælleværker aflæst* (E1, V1, operating hours) and *Foto* itself.
13. External antenna: tap **Fotografér antennen** (saved as `<meter>_antenne.jpg` with the measurement on the picture). Then choose the result and status for VVS-dialog and tap **Hent rapporten (PDF)** (saved as `<meter>.pdf`, with the antenna photo and the installation photos on the following pages). Before the first report the app asks once whether the meter readings should be included.
14. Tap **Send til VVS-dialog** and tap **li** in VVS-dialog. The report, the Ny aktivitet text and the status reach the case on their own. The **Rapporter** tab shows what has been sent and what is waiting.
15. **Før du går** (before you leave), at the bottom of the report box: ✓ for the report, the photos, the meter readings and VVS-dialog. Tap a line to see the report or photos inside the app (page with the arrows or by swiping), and close with **Luk** or the phone's back button. Reports and photos always open inside the app, also from the **Rapporter** list and from the report folder, so the app never has to be closed to come back.

**Forgot to send one day?** Open the **Rapporter** tab and tap **Søg efter rapporter i mappen** (PC) or **Tilføj rapporter fra filer** (phone: pick the PDFs in Downloads). The app finds one report per meter (the newest) from the meter number in the file name; reports already in the list or on a case are not ticked. Choose result and status on each and send. Without a result li only puts the file on the case.

VVS-dialog opens without an address bar? Tap **⋮** and choose **Open in Chrome**.

## The registry (sites and concentrators) by QR code

Work phones may not save files from Teams or mail, so the registry travels as a QR code:

1. A colleague who has the registry in the app (e.g. on a PC) taps **Lav en QR-kode af registret til kolleger** (make a QR code of the registry) under **Mere** › *Register og data*, and shows the code on screen or prints it.
2. You tap **Scan registret (QR-kode)** on the start screen (or under **Mere**) and hold the phone 20–30 cm from the code.
3. If you got the code as a picture (e.g. a screenshot), tap **Vælg et billede med QR-koden** (choose a picture).

The app says *Register læst fra QR-koden fra …* with the number of sites and concentrators. The QR code holds the concentrators' locations: share it internally only.

## The li bookmark (created once)

1. In the app: tap **Opret bogmærket li** under **Mere**, then **Kopiér koden** (copy the code).
2. In Chrome: open any page, tap **⋮** and the star.
3. Tap **Edit**. Name: `li`. Delete the address and paste the code.
4. Check that the address starts with `javascript:` – otherwise type it in front.

The bookmark only works from the address bar, not from the bookmark list. It searches for the meter number and opens the case that is not *Afsluttet* (finished) or *Lukket* (closed). If there are several open cases, you choose. It does not upload, change or delete anything.

Switch language under **Mere** › *Sprog*.

## Report folder

The browser forgets the folder permission when the app is closed. The app asks only when you tap the
button in the yellow box at start-up (or in the report box) – never by itself and never while a report
is being saved. Without permission the report goes straight to **Downloads**. If Chrome offers "Allow on
every visit", choose it. To use no folder at all: *Rapportmappe* → **Brug ingen mappe – gem altid i Overførsler**.
