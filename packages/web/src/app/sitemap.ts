import type { MetadataRoute } from "next";
import { storage } from "@/lib/storage";

export const runtime = "edge";
export const revalidate = 3600;

const BASE_URL = "https://best-deal-shops.com";

// Keep catalogs that expired within the last 2 days (grace period).
function isRecentEnough(dateTo: string): boolean {
  const end = new Date(dateTo);
  if (isNaN(end.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 2);
  return end >= cutoff;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      changeFrequency: "daily",
      priority: 1.0,
    },
  ];

  let countries: string[];
  try {
    const countryList = await storage.listCountries();
    countries = countryList.map((c) => c.code);
  } catch {
    return entries;
  }

  for (const country of countries) {
    entries.push({
      url: `${BASE_URL}/${country}`,
      changeFrequency: "daily",
      priority: 0.8,
    });

    let stores: string[];
    try {
      stores = await storage.listStores(country);
    } catch {
      continue;
    }

    for (const store of stores) {
      entries.push({
        url: `${BASE_URL}/${country}/${store}`,
        changeFrequency: "weekly",
        priority: 0.6,
      });

      let catalogs;
      try {
        catalogs = await storage.listCatalogs({ country, store, status: "ready" });
      } catch {
        continue;
      }

      for (const catalog of catalogs) {
        if (!isRecentEnough(catalog.dateTo)) continue;
        entries.push({
          url: `${BASE_URL}/${country}/${store}/${catalog.id}`,
          changeFrequency: "weekly",
          priority: 0.5,
          lastModified: new Date(catalog.dateFrom),
        });
      }
    }
  }

  return entries;
}
