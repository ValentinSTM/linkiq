# Android: full features without hosting

[Dansk](../ANDROID.md) · **English**

The browser gives GPS and the live camera only to pages from a secure address. `https://…` is one;
`http://localhost` is another. A file opened straight from the phone's storage is not.

So a small file server runs on the phone, and the app is opened in Chrome at `http://localhost`.
The server only delivers the file `linkiq.html`; measuring still happens in the page.

In daily use the Azure address is used instead. This guide is for trials without hosting.

## Steps

1. Install a "static HTTP server" app from Google Play. Example: **Simple HTTP Server**
   (package `com.phlox.simpleserver`).
2. Create a folder on the phone, e.g. `Download/linkiq`, and copy `dist/linkiq.html` into it,
   renamed to `index.html`.
3. In the server app, pick that folder as the root, keep the suggested port (usually 8080) and
   start the server.
4. Open `http://localhost:8080/` in Chrome. The address must be `localhost`, not the phone's IP
   address: only `localhost` counts as secure.
5. Allow access to location and camera the first time.
6. Chrome menu → *Add to home screen*. The app gets an icon.

The server must be running when the app is opened. Many server apps can start automatically.

## What you gain over opening the file directly

| | File opened directly | `http://localhost` or HTTPS |
|---|---|---|
| Measuring, report, photo with result | yes | yes |
| Meter number from QR | via a photo | live camera |
| Position | picked on the map | automatic GPS or map |
| Registry and sessions kept | uncertain | yes |
| Icon on the home screen | no | yes |

## iPhone

On an iPhone the practical solution is an HTTPS address, i.e. the hosted app. Server apps for iOS
exist, but the system stops them when they go into the background.
