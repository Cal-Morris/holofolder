# Holo Folder card mark

`holo-card-master.png` is the original transparent artwork. The mark is an original trading-card silhouette with a pearl border, holographic foil and one central glint. It contains no Pokémon artwork or lettering.

Run `node scripts/generate-app-icons.mjs` from the repository root to export the public logo, adaptive favicon, light/dark 32 px icons, opaque 180 px Apple touch icon and 192/512 px maskable PWA icons. Keep the full icon background square and opaque; iOS applies its own corner mask. The card stays inside the central 80% safe circle for Android masks.

The manifest and Apple touch metadata use the new card-specific filenames to bypass cached install artwork. Older icon URLs are also regenerated for bookmark compatibility. Existing iPhone installs can retain their old OS-cached icon; sync pending edits, purchases and history before removing and re-adding the Home Screen app to pick up the new Apple touch icon.
