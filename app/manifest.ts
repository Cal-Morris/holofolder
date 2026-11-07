import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Holo Folder",
    short_name: "Holo Folder",
    description: "Pokemon binder tracking with offline-friendly collection lookup, card matching, and app-style navigation.",
    start_url: "/app",
    scope: "/app",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2f5fb",
    theme_color: "#171a22",
    categories: ["productivity", "entertainment", "utilities"],
    icons: [
      {
        src: "/app/pwa-holo-card-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/app/pwa-holo-card-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/app/apple-touch-icon-holo-card.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  }
}
