import type { MetadataRoute } from "next";

/** Lets people install the app on their phone's home screen (iPhone and Android). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AACTIVATED AI BRAIN",
    short_name: "AI Brain",
    description: "Internal operating system for AACTIVATED RX.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000b1d",
    theme_color: "#000b1d",
    // Placeholder text icons until the company logo is supplied (public/icons).
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
