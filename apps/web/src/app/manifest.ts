import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Table Zero Bar",
    short_name: "TZ Bar",
    start_url: "/today",
    display: "standalone",
    background_color: "#121110",
    theme_color: "#121110",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
