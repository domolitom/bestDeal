export const runtime = "edge";
export const revalidate = 600;

import { storage } from "@/lib/storage";
import { getCoverUrl } from "@/lib/image-url";
import { getCountryName } from "@/components/Header";
import { toDisplayName } from "@/lib/display-name";
import { formatDate } from "@bestdeal/shared";

const BASE_URL = "https://best-deal-shops.com";
const FEED_URL = `${BASE_URL}/feed.xml`;

function isRecentEnough(dateTo: string): boolean {
  const end = new Date(dateTo);
  if (isNaN(end.getTime())) return false;
  // Keep entries up to 30 days past their end date
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return end >= cutoff;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822(dateStr: string): string {
  // dateStr is ISO 8601 date ("YYYY-MM-DD") or timestamp — both parse fine
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

export async function GET() {
  const allCatalogs = await storage.listCatalogs({ status: "ready" });

  const recent = allCatalogs
    .filter((c) => isRecentEnough(c.dateTo))
    .sort((a, b) => {
      const aDate = a.dateFrom;
      const bDate = b.dateFrom;
      return bDate.localeCompare(aDate);
    })
    .slice(0, 50);

  const now = new Date().toUTCString();

  const items = recent.map((catalog) => {
    const storeName = toDisplayName(catalog.store);
    const countryName = getCountryName(catalog.country);
    const dateRange = `${formatDate(catalog.dateFrom)} – ${formatDate(catalog.dateTo)}`;
    const pageInfo = catalog.pageCount ? ` (${catalog.pageCount} pages)` : "";
    const title = `${storeName} ${countryName} Catalog ${dateRange}${pageInfo}`;
    const description = `View the ${storeName} ${countryName} weekly leaflet for ${dateRange}. ${catalog.pageCount ?? "Multiple"} pages of deals and special offers.`;
    const link = `${BASE_URL}/${catalog.country}/${catalog.store}/${catalog.id}`;
    const pubDate = toRfc822(catalog.dateFrom);
    const coverUrl = getCoverUrl(catalog);

    return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(description)}</description>
      <enclosure url="${escapeXml(coverUrl)}" type="image/jpeg" length="0" />
      <category>${escapeXml(countryName)}</category>
      <category>${escapeXml(storeName)}</category>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BestDeal — Europe's Weekly Catalog Index</title>
    <link>${BASE_URL}</link>
    <description>Weekly retail catalogs from grocery, drugstore, and hardware chains across 31 European countries. Updated every Monday and Thursday.</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />
    <image>
      <url>${BASE_URL}/favicon.ico</url>
      <title>BestDeal</title>
      <link>${BASE_URL}</link>
    </image>${items.join("")}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
