# Demo videos

`record.ts` makes short vertical demo videos (1080x1920, 60 fps, about 20 s) for TikTok and Instagram Reels. It films the real Holo Folder app, installed as a home-screen web app on an iOS Simulator and signed in as the **@demo** account, with real touch input, so scrolling and page flips are native iOS. Nothing is posted or queued.

Each video opens on its payoff under a hook line, then shows how it got there while the narrator talks the whole way through. The edit adds big word-by-word captions timed to the voice, touch indicators, music, the usual short-form sound effects (a boom on the hook, pops on captions, a riser and ding on the payoff) and a short brand sting that loops back to the hook.

```fish
bun marketing/video/seed-demo.ts                    # create or refresh @demo (run before filming)
bun run marketing:video                              # film and edit every clip
bun run marketing:video card-show-hunt               # one clip
bun run marketing:video --recomposite --draft        # re-edit the last recordings, fast hardware encode
bun run marketing:video card-show-hunt --voice-preview  # hear a clip's voiceover on its own
bun run marketing:video kanto-3d --probe --reuse     # screenshot after every step, for tuning coordinates
bun run marketing:video --setup                      # rebuild the golden simulator
```

Each clip writes `marketing/video/out/<clip>.mp4` (music and sound effects, so a trending sound can be added in the app instead), `<clip>-voiceover.mp4` and `<clip>.txt` (post copy, hashtags and UTM links). `out/` is gitignored.

## Speed

- **Golden simulator.** The first run installs the app and signs in once on a simulator named **Holo Folder Video** (iPhone 18 Pro Max). Every take then films on a throwaway clone of it, so there is no reinstall or sign-in per clip. `--setup` rebuilds it.
- **Voice cache.** Voice lines are cached by voice and exact wording in `out/.voice-cache/`, so re-edits only voice lines whose wording changed.
- **Re-edits without filming.** Captions and hooks come from the script at edit time, so `--recomposite` picks up wording changes without filming again. Re-edits run two clips at a time, and `--draft` uses the hardware encoder.

## The @demo account

`seed-demo.ts` creates `demo@holofolder.com` with a comped licence and the username `@demo`. It builds two binders. **Kanto** (3x3, generation 1 preset) fills 141 of the 151 pockets from the 151 set, using illustration rares for a few showpieces, and leaves 10 chase cards empty and on the want list. **National Dex** (4x4, every Pokémon) uses the card from Cal's public `@cal/national` binder wherever it has one, read only, and otherwise a recent ordinary English printing. Both are shared at `holofolder.com/@demo/<slug>`. The password is kept in the macOS keychain (service `holofolder-demo-account`). Writes go through the developer API with a short-lived key, as `scripts/showcase-sync.ts` does. The script is idempotent and undoes anything filming changes, such as Show mode purchases or a card added to a chase pocket. Prices are never written; the app works them out.

## Voice

The narrator is Lewis: Chatterbox (MIT), run locally on the Mac through MLX, cloned from `voices/lewis.wav` (Kokoro-82M's synthetic British `bm_lewis` voice, Apache-2.0) with its exaggeration turned up for a cheeky, over-the-top delivery. A leading shouted word ("STOP!!!") is voiced on its own, cranked up further. Each line gets up to three takes; Whisper transcribes them and the take closest to the script wins. The voice is mastered like a creator's mic (EQ, de-esser, compression). `SAY_AS` in `record.ts` adjusts what is spoken, never the captions: Pokémon names only (no "ex"), prices as "quid". The script is voiced before filming, and each line waits for the previous one, so the footage holds while the narrator talks. Lines are cached in `out/.voice-cache/`. `VO_EXAGGERATION` and `VO_CFG` tune the delivery.

## Sound

The music is an upbeat lo-fi bed synthesised by ffmpeg. Taps get a click, swipes a whoosh, the hook a sub boom, each caption a pop, and the payoff a riser and a ding. Both cuts are loudness-normalised. Everything is synthesised, so there is nothing to license.

## Requirements

- Xcode with an iOS simulator runtime, [AXe](https://github.com/cameroncooke/AXe) (`brew install cameroncooke/axe/axe`), ffmpeg and [uv](https://docs.astral.sh/uv/).
- `.env.local` with `POSTGRES_URL_NON_POOLING` and `SUPABASE_SERVICE_ROLE_KEY`, for the seed only.

## Content rules

- Footage only shows our own app and the @demo collection. No third-party footage, no footage of children, no single-person shots and no faces.
- Every price and verdict on screen comes from the app. The captions only describe what is happening.
- Captions are plain British English without em-dashes. The end sting carries "Not affiliated with The Pokémon Company" and the card image credit.

## How it works

A web app's page isn't in the accessibility tree, so the scripted steps use point coordinates on the 440x956 pt screen. Install and sign-in find their buttons by OCR with tesseract.js. After a UI change, rerun with `--probe --reuse` and adjust the coordinates in `CLIPS`.
