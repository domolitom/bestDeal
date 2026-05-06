import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogGrid } from "@/components/CatalogGrid";
import { toDisplayName } from "@/lib/display-name";
import { storeConfigExists, STORE_CONFIGS } from "@/lib/store-configs";
import Link from "next/link";

export const runtime = "edge";
export const revalidate = 300;

const BASE_URL = "https://best-deal-shops.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string; store: string }>;
}): Promise<Metadata> {
  const { country, store } = await params;
  const countryName = getCountryName(country);
  const storeName = toDisplayName(store);
  const title = `${storeName} ${countryName} Catalogs — BestDeal`;
  const description = `Browse ${storeName} catalogs in ${countryName}.`;
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/${country}/${store}` },
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

// Keep catalogs that expired within the last 2 days (grace period), hide older ones.
function isRecentEnough(dateTo: string): boolean {
  const end = new Date(dateTo);
  if (isNaN(end.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 2);
  return end >= cutoff;
}

export default async function StorePage({
  params,
}: {
  params: Promise<{ country: string; store: string }>;
}) {
  const { country, store } = await params;

  // Guard: if no store config exists for this country+store slug, hard 404.
  // We check the static config lookup first (edge-compatible, no network call)
  // so pages for configured-but-not-yet-scraped stores render an empty state
  // instead of returning 404.
  if (!storeConfigExists(country, store)) {
    notFound();
  }

  const allCatalogs = await storage.listCatalogs({
    country,
    store,
  });
  const catalogs = allCatalogs.filter((c) => isRecentEnough(c.dateTo));

  const countryName = getCountryName(country);
  const storeName = toDisplayName(store);

  // Build the store pill list from the static config (all configured stores for this
  // country), merged with any stores that exist in the live manifest but aren't in
  // the config yet. Sorted alphabetically.
  const configStores: string[] = [...(STORE_CONFIGS[country] ?? [])];
  const manifestStores = await storage.listStores(country);
  const allStoresSet = new Set([...configStores, ...manifestStores]);
  const allStores = [...allStoresSet].sort();

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: BASE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: countryName,
        item: `${BASE_URL}/${country}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: storeName,
        item: `${BASE_URL}/${country}/${store}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <Header
        crumbs={[
          { label: countryName, href: `/${country}` },
          { label: storeName },
        ]}
      />
      <main className="container">
        <h1 className="page-title">
          {storeName}
        </h1>
        <p className="page-subtitle">
          {catalogs.length > 0
            ? `${catalogs.length} catalog${catalogs.length !== 1 ? "s" : ""} in ${countryName}`
            : countryName}
        </p>

        {/* Store pills */}
        <div className="store-list">
          <Link href={`/${country}`}>
            <span className="store-pill">All Stores</span>
          </Link>
          {allStores.map((s) => (
            <Link key={s} href={`/${country}/${s}`}>
              <span
                className={`store-pill ${s === store ? "store-pill-active" : ""}`}
              >
                {toDisplayName(s)}
              </span>
            </Link>
          ))}
        </div>

        {catalogs.length === 0 ? (
          <div className="empty-state">
            <h3>No catalogs yet</h3>
            <p>
              We&apos;re working on bringing you the latest deals from{" "}
              {storeName} in {countryName}. Check back soon!
            </p>
          </div>
        ) : (
          <CatalogGrid catalogs={catalogs} />
        )}
      </main>
    </>
  );
}
