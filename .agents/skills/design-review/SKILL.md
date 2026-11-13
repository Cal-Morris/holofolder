---
name: design-review
description: Self-review a Holo Folder UI change against the design system before opening a PR, and review someone else's UI PR. Use after building any visible change and before pushing.
---

# Design review

Run this before you push any visible change, and when reviewing a UI PR. It checks the work against [building-ui](../building-ui/SKILL.md) (the principles) and [design-system](../design-system/SKILL.md) (tokens, scales, components). A change that fails a step gets fixed, or the question goes to Cal. It doesn't ship with a note saying it's a tradeoff.

## 1. Reference and reuse

- [ ] Which existing screen or component is the reference? It's named in the PR.
- [ ] Every overlay is `OverlayDialog`, every confirmation is `toast()`, every action is `Button` or `holo-action`, every list choice is `OptionRow`, and every input comes from `components/ui/`.
- [ ] No new component duplicates an existing one. If two things now look alike, they share a component.
- [ ] Any new shared component is small, documented in a comment, and used in at least two places, or it replaces copies.
- [ ] Anything ambiguous, such as a new variant, a new colour or a new surface, was asked about, not invented.

## 2. Tokens and scales

- [ ] Colours come from tokens only: no hex values, no palette classes (`amber-500`, `emerald-400`…), no arbitrary colour values.
- [ ] Radius, type, control height and spacing come from the scales in design-system.
- [ ] `bun run lint` adds no warnings (the cap must not go up). `holo-design/*` and `better-tailwindcss/*` warnings in touched lines are fixed, not disabled.

## 3. Layout and behaviour on phones

- [ ] Checked at 375, 390 and 430 px, in the browser and in the standalone PWA with insets ([mobile-ui-verification](../mobile-ui-verification/SKILL.md)).
- [ ] Nothing overlaps: toasts, sheets and sticky bars don't cover inputs or actions; nothing sits under the dock or the header; no horizontal overflow.
- [ ] Tap targets are at least 36 px. Focus order and keyboard work: Tab reaches every action, Escape closes overlays, and focus returns to where it was.
- [ ] Disabled controls read as disabled only when they really are, and enabled primary actions never look faded.
- [ ] Loading, empty, offline and error states use the existing patterns and say plainly what's happening.
- [ ] Motion follows [emil-design-eng](../emil-design-eng/SKILL.md): purposeful and interruptible, and it respects reduced motion.

## 4. Side by side

- [ ] Put a 390 px screenshot of the change next to the reference screen. Do they read as the same product: same surfaces, spacing, type weight, radius and button style? If not, fix it.
- [ ] Both screenshots are in the PR body.

## Reviewing someone else's PR

Go through the same four sections. Comment with the reference you expected and the primitive to use, and phrase uncertain points as questions. A bespoke surface where a primitive exists blocks the merge.
