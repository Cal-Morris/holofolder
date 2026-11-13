---
name: design-system
description: Reference for Holo Folder's design tokens, scales, surfaces and shared components, and the lint rules that enforce them. Use when choosing colours, spacing, radius, type, buttons or surfaces, or when a design lint warning appears.
---

# Holo Folder design system

This is the reference. The process (find the reference implementation, reuse, extend, ask) lives in [building-ui](../building-ui/SKILL.md). Both follow the same principles: small reusable components, reused styles, no one-offs, and ask Cal when it's ambiguous.

The values here are taken from `app/globals.css` and from how the existing components use Tailwind. If you need something that isn't here, that's a question for Cal, not a new value.

## Colour tokens

Defined in `app/globals.css` for light (`:root`) and dark (`.dark`), and exposed to Tailwind through `@theme inline`. Always use the token class, never a hex value or a palette colour.

| Token                                 | Tailwind                                                             | Use for                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `--background` / `--foreground`       | `bg-background`, `text-foreground`                                   | Page background, body text                                                                             |
| `--card` / `--card-foreground`        | `bg-card`                                                            | Cards, sheets, panels                                                                                  |
| `--muted` / `--muted-foreground`      | `bg-muted`, `text-muted-foreground`                                  | Quiet fills and secondary text. `text-muted-foreground` is the most-used text colour after the default |
| `--primary` / `--primary-foreground`  | `text-primary`, and tints like `bg-primary/10` for selected chips    | Brand accent, links, selection. Solid primary _actions_ use `holo-action` (below)                      |
| `--secondary`, `--accent`             | `bg-secondary`, `bg-accent`                                          | Secondary buttons, hover                                                                               |
| `--destructive`                       | `bg-destructive`, `text-destructive`                                 | Delete, remove, errors                                                                                 |
| `--border`, `--input`, `--ring`       | `border-border`, `border-border/60`, `border-border/50`, `ring-ring` | Borders (`/60` and `/50` are the common softer weights), inputs, focus rings                           |
| `--highlight` / `--highlight-surface` | `text-highlight`, `bg-highlight-surface`                             | Positive and "owned" emphasis                                                                          |

**Not yet tokenised (open question for Cal):** warning, success and info colours. Today the code uses Tailwind's `amber-*` (about 190 uses, mostly Show mode and warnings), `emerald-*` (about 120, owned and success), `sky-*`, `rose-*`/`red-*` and `slate-*` directly. The `no-restricted-classes` lint flags these. Don't add more, and don't invent a token on your own; reuse what the nearest reference does until Cal decides on semantic tokens.

## Surfaces

Global classes in `app/globals.css`. They set the gradient-and-depth look, so use them rather than rebuilding it.

| Class           | Use                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `holo-panel`    | Raised chrome: sheets, the toast pill, header panels                                              |
| `holo-toolbar`  | Toolbars and bars                                                                                 |
| `holo-tile`     | Cards and tiles in grids and lists                                                                |
| `holo-selected` | The selected state of a tile or row                                                               |
| `holo-action`   | The primary action: a card fill with a thin holo foil edge. Built into `Button`'s default variant |
| `holo-progress` | Progress bars                                                                                     |
| `holo-loading`  | Loading shimmer                                                                                   |

## Scales (what the app actually uses)

- **Radius:** `rounded-full` (pills, chips, round buttons), `rounded-2xl` (sheets, large cards, action rows), `rounded-xl` (cards, inputs), `rounded-lg` (small cards). The theme derives `rounded-sm`/`md`/`lg`/`xl` from `--radius` (0.875rem). Note `rounded-sm` is 10px here, not Tailwind's default, and plain `rounded` (4px) is off-scale, so the lint flags it.
- **Type:** `text-sm` (body and controls) and `text-xs` (meta and labels) cover most text. Use `text-base` and `text-lg` sparingly for emphasis, and larger sizes only for headings and prices. Weight is usually `font-semibold` for labels and buttons and `font-medium` for body emphasis.
- **Control heights:** `h-9` (default button, chips), `h-10`/`h-11` (inputs, sheet buttons), `h-12`/`h-14` (big action rows in scanners, sheets and Show). Tap targets are never under 36 px.
- **Spacing:** horizontal padding `px-3` (most common) and `px-4`, cards `p-3`, gaps `gap-2` (default), `gap-1.5`/`gap-1` (tight) and `gap-3` (loose).
- **Bottom of screen:** `--dock-inset`, `--dock-bar` and `--dock-clearance`, plus the safe-area insets. Nothing sits under the dock.

## Shared components

See the primitives table in [building-ui](../building-ui/SKILL.md). The main ones:

- `OverlayDialog` and its parts, `components/ui/overlay-dialog.tsx` ([adding-an-overlay-or-sheet](../adding-an-overlay-or-sheet/SKILL.md))
- `toast()` from `components/ui/toast.tsx`
- `Button` from `components/ui/button.tsx`, with variants `default`, `secondary`, `outline`, `ghost` and `destructive`, and sizes `sm`, `default`, `lg` and the `icon` sizes
- `OptionRow`, `Input`, `Select` and `Switch` in `components/ui/`
- `toCardImageSrc` for card images

## Lint that enforces this

`bun run lint` (oxlint) runs these as warnings under the `--max-warnings` ratchet: new code must not add any, and the cap only goes down. The rules:

| Rule                                          | Catches                                                                                    | Fix                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `holo-design/no-handrolled-overlay`           | A `fixed inset-0` layer outside `OverlayDialog`                                            | Move it onto `OverlayDialog`                                       |
| `holo-design/no-role-dialog`                  | `role="dialog"` on a custom element                                                        | Same                                                               |
| `holo-design/primary-button-uses-holo-action` | A solid `bg-primary` `<button>` without `holo-action`                                      | Use `<Button>`, or add `holo-action`                               |
| `better-tailwindcss/no-restricted-classes`    | Raw colour values, palette colours, plain `rounded`                                        | A token from the table above, or a radius from the scale           |
| `better-tailwindcss/no-unknown-classes`       | Typos and classes that don't exist (our global classes are registered in `.oxlintrc.json`) | Fix the class. If you add a new global class, register its pattern |
| `better-tailwindcss/no-conflicting-classes`   | Two classes setting the same property (`p-2 p-4`)                                          | Keep the one you mean                                              |
| `better-tailwindcss/no-duplicate-classes`     | The same class twice                                                                       | Remove one                                                         |

The rules live in `lint/holo-design-plugin.mjs` and in the `better-tailwindcss` settings in `.oxlintrc.json`. `no-deprecated-classes` is off on purpose: its autofix turns `rounded` into `rounded-sm`, which is 10px in this theme and would visibly change radii.
