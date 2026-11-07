# Holo Folder card mark

`holo-card-master.png` is the high-resolution framed holo card used in Framer’s header, selected by Cal as the canonical mark. The old three-card SVG and concept image remain as historical sources, but production exports use the framed card only.

Run `node scripts/generate-app-icons.mjs` from the repository root. The generator trims transparent margins and exports the same artwork as favicon, opaque dark Apple/PWA icons and a transparent in-app mark. Android maskable versions keep the artwork inside the central 80%-diameter safe circle. The monochrome notification badge is a simplified single-card silhouette with the same central glint.

Canonical assets use `/app/holofolder-*` URLs to bypass cached older artwork. Older icon URLs remain compatible aliases, including maskable padding. SVG wrappers embed a compact 512 px PNG of the original artwork with no external requests; they are not editable vector recreations. Regular PNG exports render directly from the high-resolution master.

The icon background and first-launch app theme are dark, regardless of the system theme. An explicitly saved light app preference still works. Manifest launch and scope remain `/app`. Storage and image-cache identifiers stay unchanged, preserving offline cards and queued edits.

The OS controls installed icon refresh and tinting. Existing Home Screen installs may retain cached artwork. No native Apple Icon Composer layers or guaranteed Liquid Glass appearance are supplied. Device appearance and offline/browser verification remain pending under Cal’s browser-test pause.

For Framer Site Settings → General, replace both light/dark favicons with `public/holofolder-icon-512.png` and the Apple touch icon with `public/holofolder-apple-touch-icon.png`. The header already uses the framed card. These are uploadable local exports; app metadata cannot change the marketing site’s favicon settings.
