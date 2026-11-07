# Marketing style throughout the app and named binder links

Status: approved by Cal on 2026-11-07 ("yes go"). Product direction and the proposed naming behavior are approved.

## Intent

Make Holo Folder feel like the updated holofolder.com marketing site throughout the app. Add an account username and a binder slug so an enabled shared binder can be visited at `https://holofolder.com/@cal/national`.

Cal wants the marketing site's overall visual language throughout the app, rather than a few isolated matching screens. Cal will configure Framer Multi Site and needs the exact rule.

## Visual direction

Use the live marketing site's near-black background (#07070a), raised dark panels (#111116), off-white text (#f4f3f8), lavender (#b9a6ff), mint (#b8ffcf), restrained cyan (#7fe7ff), fine translucent borders, rounded panels and pill-shaped actions. The site uses Inter; use Inter for the app's primary text and JetBrains Mono for occasional numeric/technical labels, with local font loading and offline availability. Measure the font change's load cost.

Apply common tokens first, then review component-specific styling across the header, dock, binder switcher, collection/list/sets/wanted/analytics views, search and Quick mode, card detail and card selection, Show mode, settings, partner/auth screens, shared views, loading/empty/error states and Binder Studio's controls. This includes dynamic views and offline startup. The existing branded login styles are related work and must be reconciled rather than overwritten blindly.

Use clear medium-weight headings, quieter secondary text, consistent controls, subtle separation between surfaces and restrained motion. Keep operational screens compact enough for phones. Preserve binder/page customization, card artwork, finish effects and semantic price/confidence/status colors. The product should feel cohesive without making the cards compete with decorative backgrounds.

Proposed defaults: retain the light-mode option, translate the same hierarchy into light surfaces, and preserve saved theme choices. Existing dark-mode default remains. Keep current navigation, actions, collection behavior, pricing rules and overlay dismissal behavior. Changes to information architecture or features are outside the visual refresh.

## Account username and binder slug

Add an optional account username in Settings > Account. It belongs to the signed-in account, not the partnership's resolved collection owner. It is globally unique, case-insensitive, stored lowercase and never derived from an email address. Proposed validation: 3–30 ASCII letters, digits or hyphens, beginning/ending with a letter or digit. The UI displays the @ separately. Provide explicit Save, pending state, invalid/taken errors and a clear success state; do not claim availability until the server has saved it.

Add an optional slug under the selected binder's sharing settings. It belongs to that binder's owner and is unique within that owner's binders. Proposed validation: 1–60 characters with the same lowercase character rules. Suggest a slug from the binder name, let the owner edit it, and never silently change it when the display name changes. No usernames or slugs are automatically published for existing accounts/binders.

The full URL preview updates from saved username and slug. Existing token-based sharing remains available until both are configured. Account identity is distinct from display/theme settings, which currently follow collection-owner behavior in some reads.

Proposed rename policy: usernames and slugs are editable. Changing either explicitly warns that the previous named link will stop working. Retain a reservation for previously published names, so another account or binder cannot take over a previously shared address. Old addresses return 404 rather than redirecting. Reservations may be reused only by the original account/binder. This is a proposed correctness measure, not a request for general profile/history features.

An account may edit only its own username. Only the collection owner may set or change a binder's public slug; a partner can still use the existing sharing actions according to current authorization. A shared collection always uses the owner's username, never the visiting partner's. A partner can independently claim a username for their own account.

## Public access and compatibility

Resolve a named address to exactly one owner and binder, require that binder's existing `binder_shares.is_enabled` flag, then use the existing read-only binder renderer and server-side data loading. Both named and token links stop working when sharing is disabled. Unknown, disabled, deleted, incomplete or malformed identities return 404, with no fallback to another binder or account.

Keep existing token URLs working, including legacy default-binder links. Preserve binder isolation, read-only mutation guards, attribution and pricing semantics. A named share exposes the same data as that binder's existing token share, with no directory of other binders. Do not add a profile page, user search or public account listing. Keep noindex behavior for shares in this release.

Preserve the existing privacy boundary: private bootstrap/account/partner details and other binders must never be included in a public response. Audit the reused bootstrap data before connecting the new route. Do not use public caching for personalized data. Disabling a share must take effect on a new request, without a stale page cache continuing to expose it.

## Framer and app routing

The app retains `basePath: "/app"`. Proposed internal route: `/u/[username]/[binderSlug]`, publicly accessible at the origin as `/app/u/cal/national`. Avoid an App Router folder beginning with @, which has a framework meaning.

In Framer, Site Settings > Hosting > Multi Site > Add:

| Field | Value |
| --- | --- |
| Path | `/@*/*` |
| Type | External |
| URL | `https://app.holofolder.com/app/u/:1/:2` |

This combines Framer's documented wildcard capture syntax with a literal @ prefix. Expected mapping: `/@cal/national` fetches `/app/u/cal/national`, while the browser retains `https://holofolder.com/@cal/national`. Verify the exact pattern in Framer and on the published site before calling routing complete; documentation does not provide this exact @ example.

Retain the existing `/app` -> `https://app.holofolder.com/app` and `/app/*` -> `https://app.holofolder.com/app/:1` rules. Assets, APIs and client navigation continue to use the existing `/app` boundary. The named share route must render correctly when its visible browser URL differs from its internal route, including hydration, refresh, query strings, card interactions and outbound links. Test through the actual proxy, not just the Vercel origin.

Publish the new Framer rule after the internal route is deployed. No DNS or basePath change is planned. Do not redirect the origin hostname back to Framer. A bare `/@cal` does not gain a profile page in this release.

The service worker already limits navigation handling to /app paths. Keep /@ paths outside offline binder fallback and ensure the internal /app/u route is excluded as a public share too. Neither address may show cached private binder data when the network fails. Audit any public-share API/token reads and ensure revocation applies there too.

## Delivery and verification

Ship independently scoped releases: first the shared design system and app-wide styling, then account/binder identities and public routing. Split the visual work further only if needed to keep releases coherent and reviewable. Preserve all collaborator edits; exploration began on the branded-login branch with unrelated e2e edits. Recheck status before mutations and implement on isolated branches from the latest main.

Schema work needs the next free migration number at implementation time. Enforce uniqueness and validation in the database, authenticate identity writes, protect reservations with RLS and transactional operations, handle concurrent claims, and tolerate the schema being unavailable until applied. Apply only the task's required migrations to hosted Supabase and verify before enabling the feature. Keep account identity availability authoritative on the server; offline settings clearly explain that saving requires a connection.

Required checks: unit tests, typecheck, lint with no new warnings, production build and all six e2e projects. Verify the visual refresh at 375, 390 and 430 pixels in browser and standalone PWA with safe-area insets, including overlay dismissal, long labels, no overflow, dock clearance, dark/light modes, reduced motion and offline font/shell rendering.

Identity tests cover concurrent/case-insensitive collisions, validation, rename reservations, owner/partner/stranger authorization, correct binder lookup, disabled and deleted shares, old token compatibility, public response privacy, missing migrations and offline save behavior. Routing tests cover direct origin, Framer-proxied initial render/hydration, refresh and interactive requests, invalid paths, real revocation and no private offline fallback. Source or origin tests alone are not proof of Framer routing.

Follow repository release/quotas guidance for each release. Report an unconfigured/unverified Framer rule as a concrete external rollout gate.

## References

- Live visual reference, inspected 2026-11-07: https://holofolder.com/
- Framer Multi Site guide: https://www.framer.com/help/articles/how-to-use-multi-site-with-rewrite-rules/
- Existing app boundary: docs/app-routing.md
