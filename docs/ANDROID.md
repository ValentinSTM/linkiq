# Android: fuld funktion uden hosting

**Dansk** · [English](en/ANDROID.md)

Browseren giver kun sider fra en sikker adresse adgang til GPS og live-kamera. `https://…` er én;
`http://localhost` er en anden. En fil åbnet direkte fra telefonens hukommelse er ikke.

Derfor kører en lille filserver på telefonen, og appen åbnes i Chrome på `http://localhost`.
Serveren leverer kun filen `linkiq.html`; målingen foregår stadig på siden.

I daglig drift bruges adressen på Azure i stedet. Denne vejledning er til prøver uden hosting.

## Trin

1. Installér en app af typen „static HTTP server" fra Google Play. Eksempel: **Simple HTTP Server**
   (pakke `com.phlox.simpleserver`).
2. Opret en mappe på telefonen, fx `Download/linkiq`, og kopiér `dist/linkiq.html` dertil,
   omdøbt til `index.html`.
3. Vælg mappen som rod i server-appen, behold den foreslåede port (som regel 8080), og start serveren.
4. Åbn `http://localhost:8080/` i Chrome. Adressen skal være `localhost`, ikke telefonens IP-adresse:
   kun `localhost` regnes som sikker.
5. Tillad adgang til placering og kamera første gang.
6. Chrome-menuen → *Føj til startskærm*. Appen får et ikon.

Serveren skal køre, når appen åbnes. Mange server-apps kan starte automatisk.

## Hvad man vinder i forhold til at åbne filen direkte

| | Fil åbnet direkte | `http://localhost` eller HTTPS |
|---|---|---|
| Måling, rapport, foto med resultat | ja | ja |
| Målernummer fra QR | via foto | live-kamera |
| Position | valgt på kortet | automatisk GPS eller kort |
| Register og sessioner gemmes | usikkert | ja |
| Ikon på startskærmen | nej | ja |

## iPhone

På iPhone er den praktiske løsning en HTTPS-adresse, dvs. den hostede app. Server-apps til iOS
findes, men systemet stopper dem, når de går i baggrunden.
