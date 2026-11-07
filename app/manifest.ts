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
    background_color: "#07070a",
    theme_color: "#07070a",
    categories: ["productivity", "entertainment", "utilities"],
    icons: [
      { src: "/app/pwa-holo-cards-dark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/pwa-holo-cards-dark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/holo-cards-dark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/app/pwa-holo-cards-dark-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/app/pwa-holo-cards-dark-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/app/holo-cards-monochrome.svg", sizes: "any", type: "image/svg+xml", purpose: "monochrome" },
    ],
  }
}
