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
      { src: "/app/holofolder-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/holofolder-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/holofolder-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/app/holofolder-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/app/holofolder-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/app/holofolder-monochrome.svg", sizes: "any", type: "image/svg+xml", purpose: "monochrome" },
    ],
  }
}
