# Modal scroll audit, 2026-11-06

The stuck All Cards grid was reproduced with native wheel input on a local production build, using 35 explicitly synthetic printings. The supplied Arceus screenshot was inspected; its production data was not fetched or changed.

## Cause and controlled proof

`[role="dialog"] * { overscroll-behavior: none }` also applied to clipped artwork and card wrappers. Those `overflow: hidden` elements are scroll containers, so they stopped a gesture from reaching the scrolling modal body. This affected wheel input even though assigning `scrollTop` worked, which explains why the existing scroll tests missed it.

At the same mid-grid pointer position, with the same DOM and listeners:

| CSS | Start | Wheel +250 | Wheel -250 |
| --- | ---: | ---: | ---: |
| Original descendant rule | 500 | 500 | 500 |
| Scoped rule | 500 | 750 | 500 |

This controlled experiment passed three times. Position 500 was reached with wheel input, not by assigning `scrollTop`. The initial failing regression also recorded a 584 px body containing 6512 px of content on a phone. On desktop the body was 639 px with 3579 px of content; adding an explicit panel height did not fix the wheel failure. No panel height change is included.

The production fix only narrows that CSS selector to dialog boundaries and actual scrolling utility classes. It retains body/html locks, scroll containment on the real scrollers, backdrop protection, and the touch guard. The guard currently checks axis/overflow rather than available travel direction; the native containment tests did not establish a need to change it. Nested lock counts released correctly after dismissal. The binder's capturing wheel handler checks whether the event target belongs to the binder element; All Cards is portalled outside it. The CSS-only experiment leaves that handler unchanged.

## Verification matrix

`e2e/modal-scroll.e2e.ts` runs through `playwright.modal-scroll.config.ts` against a production build on port 3317. All backend/catalogue/image/price data is synthetic or mocked. No real collection mutations or provider lookups are part of the tests.

| Environment | Input and layout coverage |
| --- | --- |
| Chromium 375×667, 390×844, 430×932, browser | Wheel plus native CDP touch, light/dark |
| Same three sizes, standalone emulation | Same, with 59 px top / 34 px bottom safe-area overrides |
| Chromium 1440×900 and 800×500 | Wheel, light/dark; touch tests deliberately skipped |
| WebKit 390×844 and 1440×900 | Wheel/layout, light/dark; CDP touch and soft-keyboard emulation deliberately excluded |

The keyboard checks emulate a 300 px visual-viewport reduction while the All Cards filter is focused. They verify a reachable close button and search field, and that content still scrolls above the keyboard. This is not physical iOS keyboard validation. Headless tab foreground switching is covered; operating-system suspension is not.

| Overlay | Observed coverage | Remaining limits |
| --- | --- | --- |
| Pokémon All Cards | Wheel over artwork, text and Want button; both ends and boundary containment; native touch both directions; header stays fixed; filter focus; search highlight and Breakout jump; two close/reopen cycles; tab return; background remains still and List scrolls again after dismissal | Synthetic 35-card catalogue, not the live Arceus account |
| Illustrator browser | Wheel to both ends over cards; native touch; reachable close; lock release | Sort/filter combinations not exhaustive |
| Card selector | Wheel to both ends, touch, return from nested filters and variant sheet, return to detail | Scanner's successful recognition path not tested |
| Picker filters | Scroll where content overflows; lower selector stays at its prior position; close is reachable | No attempt to change every filter |
| Picker variant | Reachable back control; dismiss restores scrollable selector | No collection write; very small keyboard-reduced viewport not tested |
| Settings | Display tab wheel to both ends and touch, close/lock release | Other tabs statically inspected, not every control exercised |
| Partner | Open, scroll if overflowing, close bounds and lock release | Empty mocked partner/invite state only |
| Auth | Form opens, scroll if overflowing, reachable close/lock release | Default theme only; no sign-in submission or soft-keyboard/error-state matrix |
| Binder switcher | 30 synthetic binders; wheel to both ends and touch; close/lock release | Default theme only; rename/create keyboard states not exercised |
| Wanted filters/actions | Scroll where overflowing, close/cancel bounds, lock release | No destructive action or exhaustive filter combinations |
| Owned removal | Cancel and both actions fit; cancellation | No destructive action |
| Search and card detail | Real entry into highlighted All Cards; nested selector/browser return and final dismissal | Their independent long-content scroll paths not exhaustively tested |
| Header More / View options | Open, scroll if overflowing, reachable close | Not every menu action |
| Page scanner | No-camera error and close observed at 375×667 and 800×500 during the inventory probe | Successful camera capture/matching untested; not in the final regression spec |
| Quick mode / Show / Quick scanner | Static inspection of the scrolling results body and full-screen scanner layout; Show search opened during probe | Full scroll/keyboard/deal-check/scan matrix deferred; other agent's owned files untouched |
| Mobile slot actions | Static inspection: compact fixed panel above dock, no scrolling body | Long-press gesture/dismissal not independently tested |
| Sold-comps confirmation | Static inspection: height-capped scrollable dialog | No provider invocation |
| Marketing navigation | Static inspection: CSS-module scroller has its own containment | Not part of binder runtime tests |

## Remaining UX observations

- In an 800×500 desktop window, the binder's small slot can be about 42×58 px. Its hover Add/Want row intercepts the centre of the slot, preventing a centre click from opening detail. Clicking the upper part works; the regression fixture uses a real click there. This is separate from modal scrolling and was not changed.
- Wheel input over a modal's fixed header does not scroll its sibling body. Phone grabbers reserve touch input for dismissal. The fix does not introduce header-to-body gesture forwarding.
- Compact action/variant sheets do not all cap their height or provide a body scroller. Normal tested viewport bounds passed; extreme text scaling and keyboard-open variants remain unverified.
- No physical phone, live user browser, production deployment, or successful camera session was controlled. Full repository e2e was waived for this task; the focused matrix is the runtime proof.

## Local check results

- `bun run test`: 879 passed, 0 failed.
- `bun run typecheck`: passed.
- `bun run lint`: passed, 65 existing warnings, no increase.
- `bun run build`: passed with `BINDERDEX_E2E=1` and dummy local Supabase configuration.
- `E2E_BASE_URL=http://localhost:3317 bunx playwright test --config=playwright.modal-scroll.config.ts --workers=4`: 152 passed, 8 deliberate touch skips, 2.3 minutes.
- Separate controlled old-CSS/new-CSS mid-grid proof: 3/3 passed.

The full e2e suite, production deployment and physical-device validation are not claimed.
