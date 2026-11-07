# Wanted card actions implementation plan

**Goal:** Make the card being changed or removed explicit across binder details, wanted lists, the picker, Sets and Show mode.

**Architecture:** Keep exact wanted identity (card, language, finish) through navigation. Reuse collection writes and existing overlays. Replace a wanted printing in one write, preserving owned and other wanted cards.

**Approved scope:** The seven findings and recommended actions in the conversation audit.

- [x] Add regression tests for exact removal/replacement and selected wanted identity. Run failing tests first, then implement shared pure logic and precise hook mutations.
- [x] Give detail and wanted rows explicit change/remove controls. Keep owned actions separately labelled. Pass the selected wanted printing to the picker, preserving assignment on replacement.
- [x] Add direct wanted removal and change controls in Quick/Show mode. Make browser and Sets removal explicit and consistent.
- [ ] Cover tapping a non-first wanted card, preserving owned and sibling variants, replacement, Undo and mobile targets with e2e tests on all six projects.
- [ ] Run unit tests, typecheck, lint, production build and full e2e; review the final diff, push once, open and merge the PR after gates pass, verify deployment.

**Review focus:** Multiple wants for one Pokémon; same ID in different finishes/languages; owned plus wanted; last wanted removal; failed or offline writes; overlays closing without losing pending edits.

## Validation and release record

- Independent review found queued replacement Undo and saved Show finish issues; both fixed.
- Unit suite: 954 passed. Typecheck, lint (64 existing warnings, cap reduced from 65) and production build passed.
- Earlier focused browser run: 32 passed before the final sheet refinement. Later full and repeated runs were interrupted; they are incomplete, not passing evidence.
- Cal explicitly prohibited all e2e, targeted browser verification and browser benchmarks until reauthorized. Browser runners and own server stopped, queued slot cancelled. Final six-project e2e and final layout verification are skipped under that instruction.
- Partial logs and traces retained in `/tmp/wanted-full-e2e.log`, `/tmp/wanted-repeat.log` and `/tmp/wanted-repeat-results`.
- No schema, environment or dependency changes required. Release continues with permitted non-browser checks.
