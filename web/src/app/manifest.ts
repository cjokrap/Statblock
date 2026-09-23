import type { MetadataRoute } from "next";

// "Add to Home Screen": opens full screen, like an app, on the Today page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Statblock",
    short_name: "Statblock",
    description: "Food and workout tracking that plays like a D&D character sheet.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3ede2",
    theme_color: "#f3ede2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
