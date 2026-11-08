# Google Analytics

The Next.js root layout loads `GoogleAnalytics` from `@next/third-parties/google` for **G-3Z12777BKD**, only when `VERCEL_ENV=production`. Local development and preview deployments do not load Google Analytics or emit custom events. No extra environment variables are needed.

Use this single loader. The supplied **GTM-NVNZ94W3** container also targets the same property, so loading both would risk duplicate measurement. This app does not load that container. Framer's marketing pages are configured separately; a tag on the marketing site does not cover the proxied `/app` document.

## Pages and app screens

GA4 handles initial page views and browser-history changes. In the web stream's Enhanced Measurement settings, enable page views and **Page changes based on browser history events**. We do not manually send `page_view`.

Binder tabs change local state rather than URL. They emit `screen_view` with `screen_name`: `binder`, `list`, `wanted`, `sets`, `pokemon`, or `analytics`. The event also includes boolean `show_mode` and `read_only`. It runs on the initial view, when the committed view changes, or when either mode changes. Returning to a tab records another view; this is not a unique-user count.

| Event | Trigger | Parameters |
| --- | --- | --- |
| `screen_view` | Initial binder view, tab or mode change | `screen_name`, `show_mode`, `read_only` |
| `search_opened` | Open Search, Quick mode or the wanted list's price lookup | `surface`: `search`, `quick_mode`, `price_lookup` |
| `price_check_viewed` | Open a card in the deal checker, or change the card | None |

Custom payloads do not contain email, user IDs, binder IDs/names, raw queries, card data, purchase amounts or auth tokens. GA's normal page URL, referrer and automatic measurement are separate from these payloads. Analytics is best effort: blocked scripts and offline sessions can be missing. Events are not persisted or replayed alongside collection edits. Existing Vercel analytics and the first-party collector funnel remain separate.

## Reporting and verification

In GA Admin, create event-scoped custom dimensions for `surface`, `show_mode` and `read_only` to use them in reports. `screen_name` is GA's predefined screen parameter. No custom GTM triggers or event tags are needed.

Use acquisition links such as `https://holofolder.com/app?utm_source=instagram&utm_medium=social&utm_campaign=launch`; keep campaign values non-identifying. GA reads standard UTM attribution automatically.

After production deployment, check the browser's network requests for one `gtag/js?id=G-3Z12777BKD` loader and GA `g/collect` requests targeting that ID. Open the wanted list, Search and a card's price checker, and check the named events in GA Realtime or DebugView with Tag Assistant. Also navigate between actual Next routes and check that each navigation sends one page view. Property settings, custom definitions and receipt in GA require access to the Analytics account; a rendered script alone does not prove ingestion.

References: [Next.js Google integration](https://nextjs.org/docs/app/guides/third-party-libraries#google-analytics), [GA4 custom dimensions](https://support.google.com/analytics/answer/14240153).
