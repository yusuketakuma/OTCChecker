import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OTCChecker",
    short_name: "OTCChecker",
    description: "健康食品の賞味期限と在庫を iPhone で管理する PWA",
    start_url: "/",
    display: "standalone",
    background_color: "#f7efe2",
    theme_color: "#1d6b57",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
