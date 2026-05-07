import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogGrid } from "@/components/CatalogGrid";
import { toDisplayName } from "@/lib/display-name";
import { storeConfigExists, STORE_CONFIGS } from "@/lib/store-configs";
import { isCatalogActive } from "@bestdeal/shared";
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

  if (!storeConfigExists(country, store)) {
    notFound();
  }

  const allCatalogs = await storage.listCatalogs({
    country,
    store,
  });
  const catalogs = allCatalogs.filter((c) => isRecentEnough(c.dateTo));
  const activeCatalogs = catalogs.filter((c) => isCatalogActive(c.dateTo));
  const expiredCatalogs = catalogs.filter((c) => !isCatalogActive(c.dateTo));

  const countryName = getCountryName(country);
  const storeName = toDisplayName(store);

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
        <h1 className="page-title">{storeName}</h1>
        <p className="page-subtitle">
          {activeCatalogs.length > 0
            ? `${activeCatalogs.length} catalog${activeCatalogs.length !== 1 ? "s" : ""} · ${countryName}`
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
            <span className="empty-state-ornament">&#10022;</span>
            <span className="empty-state-kicker">On Press</span>
            <p className="empty-state-message">
              This issue is at the printers &mdash; fresh leaflets arrive Monday morning.
            </p>
          </div>
        ) : (
          <>
            <CatalogGrid catalogs={activeCatalogs} />

            {expiredCatalogs.length > 0 && (
              <details className="expired-section" open>
                <summary className="expired-section-title">
                  Recently expired ({expiredCatalogs.length})
                </summary>
                <CatalogGrid catalogs={expiredCatalogs} />
              </details>
            )}
          </>
        )}
      </main>
    </>
  );
}
