# Social images

`render.mjs` makes the images for our social posts from HTML templates, rendered to JPEG with Playwright. It produces three formats per blog post:

| Format    | Size      | Shape                                                                          |
| --------- | --------- | ------------------------------------------------------------------------------ |
| Instagram | 1080×1350 | 4:5 carousel: a cover, three key points from the blog post and a closing slide |
| X         | 1600×900  | One headline-led image                                                         |
| TikTok    | 1080×1920 | The Instagram slides as a 9:16 photo carousel, kept clear of TikTok's controls |

The look follows holofolder.com and the app's dark tokens: `#07070a` background, `#b9a6ff` accent, Inter for type and JetBrains Mono for numbers. Visuals are screenshots of the public showcase binders taken at a 390×844 phone viewport in en-GB (so prices show in pounds), or card images from our own mirror at `assets.holofolder.com`. Any slide that shows card art carries "Not affiliated with The Pokémon Company".

## Running it

```fish
bun run social-images capture   # screenshots of the showcase binders into marketing/social/out/shots
bun run social-images render    # every slide, plus out/contact-sheet.html to review them
bun run social-images upload    # out/*.jpg to R2 at marketing/social/<yyyy-mm>/<slug>/<format>-<n>.jpg
```

`render` and `upload` take an optional comma-separated list of post slugs. `upload` needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for the `holofolder-assets` bucket. A short-lived token scoped to that bucket is enough. The public URL is `https://assets.holofolder.com/marketing/social/<yyyy-mm>/...`. `SOCIAL_MONTH` sets the month folder.

## Adding a post

Add an entry to `POSTS` with the blog post's slug, a cover (eyebrow, title, sub and visual) and three points. Every word and number has to come from the published blog post or what the app shows. Don't write new claims, prices or card facts on a slide. Check the contact sheet before uploading. Buffer fetches the image when the post goes out, so an uploaded URL must stay in place until then.

## Binder inspiration series

A weekly themed nine-pocket page (a type, an evolution line, an artist, a region, a mood or a trainer), posted to Instagram, TikTok and X. Every theme is a real showcase binder anyone can open at `holofolder.com/@showcase/<slug>`, with a matching item in the Framer Collections CMS. The page slide is the 3 × 3 page filling the frame like a photo of a real binder page, over a blurred copy of its own cards, with only a small theme and holofolder.com line and "Not affiliated with The Pokémon Company" underneath. The theme title goes in the caption. Instagram and TikTok get the page and close-ups of three standout pockets, X gets the page beside the theme line, and a 900×900 square goes to the Collections item.

A weekly run:

1. **Pick a theme** that isn't on [holofolder.com/collections](https://holofolder.com/collections) yet, and find cards in our catalogue. Keep the nine cards to one colour story (all reds, all night skies, all pastels): the page reads as one picture and the blurred backdrop takes that colour, while a mixed page turns it muddy. Full-art cards (illustration rares and up) fill the pockets best. `find` lists illustration rares and special illustration rares by default, and marks any card whose image doesn't load from `assets.holofolder.com`:

   ```fish
   bun run binder-inspo find --type Dragon
   bun run binder-inspo find --artist '^Teeziro$'
   bun run binder-inspo find --dex 252-386 --limit 90           # a region, by National Dex number
   bun run binder-inspo find --name '^(pichu|cleffa)$' --rarity 'Rare,Illustration rare'
   ```

2. **Add the page** to `scripts/showcase-pages.json` with `"cards"` (nine `{ kind, cardId, language, finish }` identities in pocket order) and a 3 × 3 `view`. Use `holo` when the printing only exists as a holo (check `variants_json`).
3. **Check every image**: `bun run binder-inspo check <slug>` fails on any card without a working image, so swap it before going further. It also writes `out/binder-inspo.json` for the renderer.
4. **Create the binder**: `bun run scripts/showcase-sync.ts --dry-run`, then without `--dry-run`. It creates the binder on the showcase account, fills it, sets the slug and turns sharing on. Real runs refuse to write unless `showcase-pages.json` matches `origin/main`, because a stale checkout would undo newer showcase pages; pass `--allow-unmerged` while the new page is still in its PR.
5. **Render**: add `{ slug, sub, standouts }` to `INSPO` in `render.mjs` (the sub line is the only free text on the images, so keep it to what the page shows), run `bun run social-images render <slug>`, check `out/contact-sheet.html`, then `upload`.
6. **Collections page**: add a Collections CMS item in Framer like the existing ones (Name, Slug, Description, Preview from `out/<slug>/preview-1.jpg` on R2, Binder URL, Cards list, Story with The colours, Standout cards and Make your own linking Binder Studio, Embed URL), then publish once `api.publishing.status()` shows only your changes.
7. **Buffer**: Instagram and TikTok use the carousel images and "link in bio", X uses `x-1.jpg` and the binder link with `?utm_source=x&utm_medium=social&utm_campaign=social`. Ask "Which pocket would you swap?". The free plan holds 10 scheduled posts, so anything past that goes in as a dated draft.
