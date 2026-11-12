# Holo Folder card mark

`holo-card-master.png` is the high-resolution framed holo card used in Framer’s header, selected by Cal as the canonical mark. The old three-card SVG and concept image remain as historical sources, but production exports use the framed card only.

Run `node scripts/generate-app-icons.mjs` from the repository root. The generator trims transparent margins and exports transparent browser favicon PNG, SVG and ICO files, plus a 512 px transparent Framer favicon. Apple touch and PWA install icons keep their opaque dark backgrounds; the in-app mark remains transparent. Android maskable versions keep the artwork inside the central 80%-diameter safe circle. The monochrome notification badge is a simplified single-card silhouette with the same central glint.

Canonical assets use `/app/holofolder-*` URLs to bypass cached older artwork. Older icon URLs remain compatible aliases, including maskable padding. SVG wrappers embed a compact 512 px PNG of the original artwork with no external requests; they are not editable vector recreations. Regular PNG exports render directly from the high-resolution master.

The icon background and first-launch app theme are dark, regardless of the system theme. An explicitly saved light app preference still works. Manifest launch and scope remain `/app`. Storage and image-cache identifiers stay unchanged, preserving offline cards and queued edits.

The OS controls installed icon refresh and tinting. Existing Home Screen installs may retain cached artwork. No native Apple Icon Composer layers or guaranteed Liquid Glass appearance are supplied. Device appearance and offline/browser verification remain pending under Cal’s browser-test pause.

For Framer Site Settings → General, replace both light/dark favicons with `public/holofolder-favicon-512.png`. Keep the existing Apple touch icon unchanged. The header already uses the framed card. These are uploadable local exports; app metadata cannot change the marketing site’s favicon settings.
