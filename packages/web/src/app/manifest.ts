import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BestDeal — European Catalog Review",
    short_name: "BestDeal",
    description:
      "Weekly retail catalogs from grocery, drugstore, and hardware chains across 31 European countries.",
    start_url: "/",
    display: "standalone",
    background_color: "#F4EEDE",
    theme_color: "#1A1714",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    categories: ["shopping", "lifestyle", "news"],
    lang: "en",
  };
}
