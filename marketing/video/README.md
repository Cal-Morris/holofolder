# Demo videos

`record.ts` makes short vertical demo videos (1080x1920, 60 fps, 20 to 40 s) for TikTok and Instagram Reels. It films the real Holo Folder app, installed as a home-screen web app on an iOS Simulator and signed in as the **@demo** account, with real touch input, so scrolling and page flips are native iOS. Posting is a separate, deliberate step (see "Posting").

Each video opens on its payoff under a spoken hook, then walks through how it got there: the narrator says what they are doing and the taps happen as they say it. Captions sit in a band above the phone, a few words at a time, so they never cover the app. Behind the phone is the marketing site's backdrop (deep navy with soft holographic streaks), drifting slowly. Every video has a quiet lo-fi bed under the voice and no sound effects. A short brand sting loops back to the hook.

```fish
bun marketing/video/seed-demo.ts                    # create or refresh @demo (run before filming)
bun run marketing:video                              # film and edit every clip
bun run marketing:video card-show-hunt               # one clip
bun run marketing:video national-dex --recomposite   # re-edit the last recording (new music or captions), no filming
bun run marketing:video card-show-hunt --voice-preview  # hear a clip's narration on its own
bun run marketing:video kanto-3d --probe             # screenshot after every step, for tuning a script
bun run marketing:video --setup                      # rebuild the golden simulator
```

Each clip writes `marketing/video/out/<clip>.mp4` and `<clip>.txt` (post copy, hashtags, UTM links and credits). `out/` is gitignored.

## Editing a video

Every video is one entry in `clips.ts`, and that is the only file to touch for a new script or a new video:

- `hook`: the first line, spoken over the payoff. Write it as a first-person result ("This app just saved me £75 at a card show.").
- `steps`: alternate a `caption` (one spoken line) with the taps it describes. The narrator says the line and the taps play while they talk; the next line starts when they finish. Start with "Watch.", narrate each action as it happens with a bit of personality, land the payoff, and end on `"Holo Folder. Link's in the bio."` as its own line.
- `coldOpen.mark`: the step marked with `{ mark }` that is shown first, under the hook.
- `post`, `question`, `tags`: the post copy written to `<clip>.txt`.

Steps: `tap` (points on the 440 x 956 pt screen), `tapText` (tap on-screen words found by OCR, optionally nudged by `offset`), `again` (the last `tapText` spot again, fast), `swipe`, `type`, `keys`, `open` (a URL, as tapping a shared link would), `wait`, `mark`. Prefer `tapText` for anything whose position moves (list rows, menus, the dock right after launch). `setup` steps run off camera before recording, for warming images. Terminal clips (`terminal: true`) use `cmd` and `agent` steps instead. A `cmd` really runs against the API as @demo and its real output is typed out; `expect` must appear in it. An `agent` step asks the real Claude Code CLI (`claude -p`), with only Holo Folder's MCP server attached and signed in as @demo through the real OAuth flow with the default read-only access; its tool calls and answer are shown as they happened. The run is cached by prompt in `out/.agent-cache/` so the narration keeps matching; delete the file to ask again. Keep agent narration general ("cheapest first"), not the exact numbers it said.

After changing a script, run `--probe` on that clip to check every step lands, then film it. Changing only the hook, captions' wording or music needs no refilm if the line count is unchanged: `--recomposite`.

## The @demo account

`seed-demo.ts` creates `demo@holofolder.com` with a comped licence and the username `@demo`. It builds two binders. **Kanto** (3x3, generation 1 preset) fills 141 of the 151 pockets from the 151 set, using illustration rares for a few showpieces, and leaves 10 chase cards empty and on the want list. **National Dex** (4x4, every Pokémon) uses the card from Cal's public `@cal/national` binder wherever it has one, read only, and otherwise a recent ordinary English printing. Both are shared at `holofolder.com/@demo/<slug>`. The password is kept in the macOS keychain (service `holofolder-demo-account`). Writes go through the developer API with a short-lived key (`withDemoKey`), as `scripts/showcase-sync.ts` does. The script is idempotent and undoes anything filming changes, such as Show mode purchases. Prices are never written; the app works them out.

## Voice

The narrator is a York voice: Qwen3-TTS (Apache-2.0), run locally on the Mac through MLX, cloned from `voices/york.wav`, a 20-second recording of speaker p287 (a 23-year-old man from York) from the VCTK speech corpus (CC BY 4.0, CSTR, University of Edinburgh). Each clip's whole script is spoken in one continuous take, so the accent and energy don't drift between lines. Whisper transcribes up to three takes with word timings and the closest to the script wins; it is cut into one file per line at the quietest moment between lines, untrimmed, so the lines laid end to end are the take as spoken, with a short breath after each sentence. The voice goes into the video unprocessed. `SAY_AS` in `record.ts` adjusts what is spoken, never the captions: Pokémon names only (no "ex"), numbers in words, prices as "quid" ("£150" is said "a hundred and fifty quid"). The script is voiced before filming and the footage follows the voice's timing. Takes are cached per clip script in `out/.voice-cache/`.

## Music

Every video gets a slow, quiet lo-fi bed made by ffmpeg (`lofiExpr` in `record.ts`), so there is nothing to license: soft seventh chords, a gentle kick and snare, swung hats and a little vinyl crackle, lowpassed and sitting well under the voice, dipping further while the narrator talks. To use a real track instead, put one you have the rights to at `music/<clip>.mp3` (or `music/default.mp3`) with its licence line in `music/<clip>.txt`; the licence line goes into `<clip>.txt` for the post. `music/` is gitignored.

## Posting

Upload the MP4 to `assets.holofolder.com/marketing/videos/` (a public link Buffer can fetch), then create the posts in Buffer for TikTok and Instagram Reels with the copy from `<clip>.txt`, marked as AI-generated (the voice is synthetic). Only post what Cal has picked.

## Speed

- **Golden simulator.** The first run installs the app and signs in once on a simulator named **Holo Folder Video** (iPhone 18 Pro Max). Every take films on a throwaway clone of it. `--setup` rebuilds it. If its sign-in ever lapses, the take shows the sign-in screen: rerun `--setup`.
- **Voice cache.** Each clip's take is cached by voice and exact script, so re-edits only voice a clip again when its script changes.
- **One bad take doesn't stop the run.** A failed clip is reported at the end and the rest carry on.

## Requirements

- Xcode with an iOS simulator runtime, [AXe](https://github.com/cameroncooke/AXe) (`brew install cameroncooke/axe/axe`), ffmpeg, jq and [uv](https://docs.astral.sh/uv/).
- `.env.local` with `POSTGRES_URL_NON_POOLING` and `SUPABASE_SERVICE_ROLE_KEY`, for the seed and the API clip.

## Content rules

- Footage only shows our own app and the @demo collection. No third-party footage, no footage of children, no single-person shots and no faces.
- Every price and verdict on screen comes from the app or the API. The narration only describes what is happening, and must stay true when the data changes (avoid exact prices in the script).
- Captions are plain British English without em-dashes. The end sting carries "Not affiliated with The Pokémon Company" and the card image credit; the post copy credits the voice and any music.

## How it works

A web app's page isn't in the accessibility tree, so steps use point coordinates or OCR (tesseract.js). The app is ready once its dock labels can be read. iOS prompts that dim the screen (motion access) are detected by brightness and answered before filming.
