import type { MetadataRoute } from "next";

// Lets Armada be added to a phone's home screen or installed as an app, with its own mark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Armada",
    short_name: "Armada",
    description: "Every shop you run, on one screen.",
    start_url: "/",
    display: "standalone",
    background_color: "#111418",
    theme_color: "#111418",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
