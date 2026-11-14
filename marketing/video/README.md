# Demo videos

`record.ts` makes short vertical demo videos (1080x1920, 60 fps, H.264 with a silent AAC track, 20 to 23 s) for TikTok and Instagram Reels. It drives the real production site in Mobile Safari on an iOS Simulator, records the screen with `simctl`, and composites a hook, one caption per beat, touch indicators and a 2 s end card with ffmpeg. The prototype doesn't post or queue anything.

```fish
bun run marketing:video                       # all clips
bun run marketing:video card-show-price-check # one clip
bun run marketing:video binder-prices --probe # screenshots after every step, no recording
```

Each clip writes `marketing/video/out/<clip>.mp4` and a `<clip>.txt` with the post copy, hashtags and the UTM links. The `out/` folder is gitignored, and `out/.work/<clip>/` keeps the raw recording, timeline and overlay PNGs.

## Requirements

- Xcode with an iOS simulator runtime. The script creates and owns a simulator named **Holo Folder Video** (iPhone 18 Pro Max), and erases it before every clip so Show mode, cached prices and Safari state never carry over.
- [AXe](https://github.com/cameroncooke/AXe) for taps, swipes and typing: `brew install cameroncooke/axe/axe`. Swipes are real touch input, so scrolling has native iOS momentum.
- ffmpeg (`brew install ffmpeg`). Overlays are rendered as PNGs by Playwright's Chromium, so ffmpeg doesn't need `drawtext`.

## Content rules

- Footage comes only from public, signed-out pages: the curated `@showcase` binders and the views they open (Browse, Sets, Search, Quick mode, Show mode). Production redirects signed-out visitors at `/app` to sign-in, so the showcase binder is the entry point.
- Every price on screen comes from the app. Captions describe what the app does and never state a price or verdict themselves.
- Captions are plain British English with no em-dashes. The end card carries "Not affiliated with The Pokémon Company" and the card image credit.

## How it works

1. A clean simulator: erase, boot, dark appearance, a 9:41 status bar.
2. Open the showcase URL in Safari, choose Hide Toolbar from the Page Menu, and dismiss the motion permission prompt, all before recording starts.
3. Run the clip's optional `setup` steps (for example turning on Show mode), then start `simctl io recordVideo` and run its `steps`, logging when each caption and gesture happens.
4. Crop off Safari's address pill, scale the screen into a rounded frame under a caption band, overlay captions and touch dots at the logged times, cross-fade into the end card, and encode.

Coordinates are points on the iPhone 18 Pro Max (440x956). Safari doesn't expose web content to accessibility, so they are hand-tuned. When the UI changes, run `--probe` and adjust them.
