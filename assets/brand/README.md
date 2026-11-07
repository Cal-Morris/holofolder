# Holo Folder card marks

`holo-cards-mark.svg` is the editable vector source: a holographic glint card, rose/lilac crescent card and mint/cyan ring card. It uses paths, shapes and gradients, with no embedded raster images or external resources. `holo-cards-master.png` preserves the generated concept reference; the original single-card `holo-card-master.png` also remains unchanged.

Run `node scripts/generate-app-icons.mjs` from the repository root. All production PNG/ICO exports render from the SVG source. The generator exports a transparent SVG/PNG logo, light/dark SVG icons and 32 px favicons, a 16/32/48/64 px ICO, an adaptive SVG, a transparent glass-style SVG, maskable and monochrome SVGs, an opaque 180 px Apple touch icon, regular 192/512/1024 px app icons and separate Android maskable icons. Maskable artwork fits inside the central 80%-diameter safe circle. iOS supplies its own corner mask.

The public assets are served under `/app`, including `/app/holo-cards-mark.svg`, `/app/holo-cards-light.svg`, `/app/holo-cards-dark.svg`, `/app/holo-cards-glass.svg` and `/app/holo-cards-monochrome.svg`. Framer marketing can use these asset URLs independently of Next app routing. The app manifest retains `/app` launch and scope. New multi-card URLs bypass cached artwork, and old icon URLs remain compatible aliases, with old maskable URLs keeping safe padding.

## Appearance support

The favicon and adaptive SVG respond to `prefers-color-scheme`. The manifest supplies `any`, `maskable` and `monochrome` purposes for supporting browsers/launchers. The monochrome silhouette provides a tintable alpha mask. The glass SVG is translucent artwork for web/design use, not native Apple Icon Composer layers.

Installed icon selection and theme refresh depend on the browser and OS. Web manifests do not supply native Apple dark/tinted/clear icon layers. Do not advertise guaranteed native Liquid Glass support. Apple touch uses the opaque default; the OS controls Home Screen restyling. Existing installs may keep OS-cached artwork; changing the artwork does not require clearing app data or deleting queued edits. Physical-device appearance needs separate verification.

References: [WebKit SVG icons](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#svg-icons), [web manifest icon purposes](https://www.w3.org/TR/appmanifest/#purpose-member), [Apple icon appearances](https://developer.apple.com/design/human-interface-guidelines/app-icons).
