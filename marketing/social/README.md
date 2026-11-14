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
