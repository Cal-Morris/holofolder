---
name: building-ui
description: Build or change any visible Holo Folder UI from small reusable primitives and existing reference implementations, never one-off surfaces. Use before writing UI code for a feature, a sheet, a confirmation, a button row or a list.
---

# Building UI

Holo Folder should read as one product. Every new piece of UI is built from the primitives and styles that already exist. When nothing fits, extend a primitive rather than build a one-off.

## Principles

1. **Find the reference implementation first.** Before writing markup, find the screen or component on the site that already does the same job: a sheet with a filter list, a confirmation, an action row, a list of cards, an empty state. Reuse it or its parts. Name the reference in your PR.
2. **Prefer small, reusable components.** Build from the primitives below. When the same markup shows up in 2–3 places without a shared component, extract one into `components/ui/` (or the feature's folder, if it's specific to that feature) and move the copies onto it in the same PR.
3. **Reuse styles, don't restyle.** Use the colour tokens in `app/globals.css`, the `holo-*` surface classes and the existing spacing, radius and type scale. No raw hex or RGB colours, and no Tailwind arbitrary values where a token or scale step exists.
4. **Extend, don't fork.** If a primitive almost fits, add a prop or variant to it (and document it) instead of copying it into a new component.
5. **Ask when it's ambiguous.** If two patterns could apply, or a primitive would need a real design decision such as a new variant or a new surface, stop and ask Cal with the options and a recommendation. Don't guess and ship a one-off.
6. **Compare before you ship.** Put a 390 px screenshot of your change next to the reference screen. They should look like the same product.

## Primitives (use these)

| Need                                               | Use                                                                                                                                                                                                                                                                                                     | Not                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Sheet, modal, menu                                 | `OverlayDialog` with `OverlayHeader`, `OverlayFooter`, `OverlayGrabber`, `OverlayCloseButton` and `OverlayMenu` (`components/ui/overlay-dialog.tsx`). See [adding-an-overlay-or-sheet](../adding-an-overlay-or-sheet/SKILL.md). Pass `modal={false}` only for overlays that must leave the dock usable. | A hand-rolled `fixed inset-0` layer, a `role="dialog"` div, or a copied backdrop |
| Confirmation after an action, optionally with Undo | `toast()` (`components/ui/toast.tsx`), the pill above the dock, one at a time                                                                                                                                                                                                                           | An inline banner or strip under the buttons                                      |
| Primary action                                     | `Button` (`components/ui/button.tsx`) with the default variant, which uses `holo-action`. For big full-width action rows, use the same `holo-action` class on the existing action-row pattern (see the scanners and review sheets).                                                                     | A custom fill colour, or a pale or lavender fill that reads as disabled          |
| Secondary, outline, ghost and destructive actions  | The `Button` variants `secondary`, `outline`, `ghost` and `destructive`                                                                                                                                                                                                                                 | One-off border and background combinations                                       |
| A choice in a list (set, promo, card to leave out) | `OptionRow` (`components/ui/option-row.tsx`), with `selected` for toggles                                                                                                                                                                                                                               | A new row component with the same layout                                         |
| Text and number inputs, selects, switches          | `Input`, `Select` and `Switch` in `components/ui/`                                                                                                                                                                                                                                                      | Native unstyled inputs, or a restyled copy                                       |
| Surfaces                                           | `holo-panel` (raised chrome), `holo-toolbar`, `holo-tile` (cards and tiles), `holo-selected` (selected state), `holo-progress`                                                                                                                                                                          | New gradients or shadows                                                         |
| Card images                                        | The shared card image path (`toCardImageSrc` in `lib/card-image-url.ts`)                                                                                                                                                                                                                                | A bare `<img>` with a raw source URL                                             |

Positioning near the bottom of the screen uses `--dock-inset`, `--dock-bar` and `--dock-clearance`, plus the safe-area insets. Nothing goes under the dock.

## Checklist for a UI change

- [ ] Named the reference implementation, and reused it or its parts
- [ ] Every surface, button, input, overlay and confirmation comes from the primitives above
- [ ] Any new shared component is small, documented, and actually used in 2 or more places, or replaces copies
- [ ] No raw colours, and no arbitrary values where a token exists
- [ ] Asked Cal about anything ambiguous instead of inventing a pattern
- [ ] Checked at 375, 390 and 430 px, in browser and standalone mode ([mobile-ui-verification](../mobile-ui-verification/SKILL.md)), with tap targets at least 36 px and no overflow
- [ ] 390 px screenshot in the PR next to the reference screen

## Related

- [adding-an-overlay-or-sheet](../adding-an-overlay-or-sheet/SKILL.md) for overlays specifically
- [mobile-ui-verification](../mobile-ui-verification/SKILL.md) for viewport and standalone checks
- [emil-design-eng](../emil-design-eng/SKILL.md) for polish, animation and interaction detail
- [design-system](../design-system/SKILL.md) for tokens, scales, surfaces and the design lint rules
- [design-review](../design-review/SKILL.md), the self-review to run before pushing a UI change
