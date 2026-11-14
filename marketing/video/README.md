# Demo videos

`record.ts` makes short vertical demo videos (1080x1920, 60 fps, H.264 with a silent AAC track, about 20 s) for TikTok and Instagram Reels. It films the real Holo Folder app, installed as a home-screen web app on an iOS Simulator and signed in as the **@demo** account. The screen is recorded with `simctl`, and ffmpeg composites the result. Every video opens on its payoff (the 3D binder, the collection value, the Show mode verdict) under a hook line, then cuts back to show how it got there with one caption per beat and touch indicators, and ends on a 2 s end card. Nothing is posted or queued.

```fish
bun marketing/video/seed-demo.ts               # create or refresh @demo (run before filming)
bun run marketing:video                         # all clips, each from a fresh install
bun run marketing:video card-show-hunt          # one clip
bun run marketing:video kanto-3d --probe --reuse  # screenshot after every step, on the already signed-in simulator
bun run marketing:video --recomposite           # re-edit the last recordings without the simulator
```

Each clip writes `marketing/video/out/<clip>.mp4` and a `<clip>.txt` with the post copy, hashtags and UTM links. `out/` is gitignored, and `out/.work/<clip>/` keeps the raw recording, its timeline and the overlay PNGs.

## The @demo account

`seed-demo.ts` creates `demo@holofolder.com` with a comped licence and the username `@demo`, then builds a **Kanto** binder from the generation 1 preset. It fills 141 of the 151 pockets from the 151 set, using illustration rares for a few showpieces, and leaves 10 chase cards empty and on the want list, so Analytics and Show mode have real work to do. The binder is shared at `holofolder.com/@demo/kanto`. The password is kept in the macOS keychain (service `holofolder-demo-account`). Writes go through the developer API with a short-lived key, as `scripts/showcase-sync.ts` does. The script is idempotent and also undoes anything filming changes, such as purchases recorded in Show mode or a card added to a chase pocket. Prices are never written; the app works them out.

## Requirements

- Xcode with an iOS simulator runtime. The script owns a simulator named **Holo Folder Video** (iPhone 18 Pro Max) and erases it before every clip.
- [AXe](https://github.com/cameroncooke/AXe) for real touch input: `brew install cameroncooke/axe/axe`.
- ffmpeg (`brew install ffmpeg`). Text overlays are rendered by Playwright's Chromium.
- `.env.local` with `POSTGRES_URL_NON_POOLING` and `SUPABASE_SERVICE_ROLE_KEY`, for the seed only.

## Content rules

- Footage only shows our own app and the synthetic @demo collection, never a real user's account.
- Every price and verdict on screen comes from the app. The captions only describe what is happening.
- Captions are plain British English without em-dashes. The end card carries "Not affiliated with The Pokémon Company" and the card image credit.
- No third-party footage or music. Show-floor clips Cal films himself can be cut in later.

## How it works

A web app's page isn't in the accessibility tree, so the scripted steps use point coordinates on the 440x956 pt screen. Install and sign-in find their buttons by OCR with tesseract.js, because the keyboard and status messages move the layout around. After a UI change, rerun with `--probe --reuse` and adjust the coordinates in `CLIPS`.
