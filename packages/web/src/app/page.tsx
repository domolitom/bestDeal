import type { Metadata } from "next";
import { storage } from "@/lib/storage";
import { Header } from "@/components/Header";
import { CountrySelector } from "@/components/CountrySelector";
import { COUNTRY_META } from "@bestdeal/shared";

export const runtime = "edge";
export const revalidate = 300;

const BASE_URL = "https://best-deal-shops.com";

/** ISO week number (Monday-based) */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "BestDeal — Europe's Weekly Catalog Index";
  const description =
    "Browse weekly retail catalogs from grocery, drugstore, and hardware chains across 31 European countries. Updated every Monday and Thursday.";
  return {
    title,
    description,
    alternates: { canonical: BASE_URL },
    openGraph: { title, description, type: "website", url: BASE_URL },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function HomePage() {
  let countries: Awaited<ReturnType<typeof storage.listCountries>> = [];
  try {
    countries = await storage.listCountries();
  } catch {
    // Empty bucket or CDN connection error — show empty state
  }

  const now = new Date();
  const week = isoWeek(now);
  const issueNum = String(week).padStart(3, "0");

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "BestDeal",
    url: BASE_URL,
    description:
      "Browse weekly retail catalogs from grocery, drugstore, and hardware chains across 31 European countries. Updated every Monday and Thursday.",
  };

  // Build ItemList from all countries that have COUNTRY_META entries,
  // preferring countries currently present in the manifest (with catalogues),
  // but falling back to the full COUNTRY_META list so the list is always non-empty.
  const countryEntries =
    countries.length > 0
      ? countries.map((c) => ({ code: c.code, name: c.name }))
      : Object.entries(COUNTRY_META).map(([code, meta]) => ({
          code,
          name: meta.name,
        }));

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: countryEntries.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      url: `${BASE_URL}/${c.code}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <Header />
      <main className="container">
        <div className="home-masthead">
          <p className="home-masthead-kicker">
            BestDeal &nbsp;&middot;&nbsp; Issue &nbsp;&#x2116;{issueNum}
          </p>
          <h1 className="home-masthead-title">Europe&rsquo;s<br />Catalog Index</h1>
          <p className="home-masthead-subtitle">
            Weekly leaflets from supermarkets, drugstores and hardware chains across the continent &mdash; curated twice a week.
          </p>
        </div>
        <CountrySelector countries={countries} />
      </main>
    </>
  );
}
