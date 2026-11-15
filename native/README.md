# Holo Folder iOS app

A thin Expo shell: one full-screen `react-native-webview` on the live `https://holofolder.com/app`. The web app is the product; this folder only holds what has to be native. The plan and the reasons for Expo over Capacitor are in `~/dev/plans/holofolder-native-apps-2026-11-15/README.md`.

This is its own project, deliberately not a Bun workspace: Expo pins its own React and React Native, so it keeps its own `package.json` and `bun.lock`, and the root typecheck, lint, format and knip skip it.

## Run it

Needs Xcode and CocoaPods (`brew install cocoapods`).

```sh
cd native
bun install
bun run ios                       # builds, installs on a simulator and starts Metro
bun run ios -- --device           # pick a plugged-in iPhone (needs your Apple team in Xcode signing)
bun run typecheck
```

`ios/` is generated from `app.json` by `expo prebuild` and is gitignored. Change `app.json`, then `bunx expo prebuild --clean`; never hand-edit `ios/`.

## How the web app sees the shell

- Before the page loads, the shell sets `navigator.standalone = true` and `window.HoloFolderNative = { platform: 'ios' }`. The web app already treats `navigator.standalone` as the installed PWA (safe areas, edge swipe-back, no install prompts), so it needs no changes.
- The user agent ends with `HoloFolderApp/1`.
- Only `holofolder.com/app` and `app.holofolder.com/app` stay in the app. Every other top-level link and `target=_blank` window opens in Safari.

## Offline

WKWebView only runs service workers on app-bound domains, so `WKAppBoundDomains` lists `holofolder.com`, `app.holofolder.com` and `assets.holofolder.com`, and the webview sets `limitsNavigationsToAppBoundDomains`. A first launch with no connection shows the "Can’t reach Holo Folder" screen; after one online launch the service worker serves the app shell.
