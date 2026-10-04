import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Donor Desk",
    short_name: "Donor Desk",
    description: "Donor outreach tracker with an agent that checks in for you.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#1f6f5c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
