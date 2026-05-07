import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogStoreRows } from "@/components/CatalogStoreRows";
import { toDisplayName } from "@/lib/display-name";
import { STORE_CONFIGS } from "@/lib/store-configs";
import { isCatalogActive } from "@bestdeal/shared";
import Link from "next/link";

export const runtime = "edge";
export const revalidate = 300;

const BASE_URL = "https://best-deal-shops.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string }>;
}): Promise<Metadata> {
  const { country } = await params;
  const countryName = getCountryName(country);
  const title = `${countryName} Catalogs — BestDeal`;
  const description = `Browse weekly retail catalogs from stores in ${countryName}.`;
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/${country}` },
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

function buildIntroText(
  countryName: string,
  catalogCount: number,
  storesWithCatalogs: string[]
): string {
  const catalogWord = `${catalogCount} weekly catalog${catalogCount !== 1 ? "s" : ""}`;
  if (storesWithCatalogs.length === 0) {
    return `No catalogs available for ${countryName} right now. Check back soon!`;
  }
  const storeNames = storesWithCatalogs.map(toDisplayName);
  let storeList: string;
  if (storeNames.length === 1) {
    storeList = storeNames[0];
  } else if (storeNames.length === 2) {
    storeList = `${storeNames[0]} and ${storeNames[1]}`;
  } else {
    storeList = `${storeNames.slice(0, -1).join(", ")}, and ${storeNames[storeNames.length - 1]}`;
  }
  return `Browse ${catalogWord} from stores in ${countryName} including ${storeList}.`;
}

export default async function CountryPage({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country } = await params;
  const manifestStores = await storage.listStores(country);

  // Build the full store list from the static config (all configured stores for
  // this country) merged with any manifest stores. Mirrors the same approach
  // used by the store page so both pages stay consistent.
  const configStores: string[] = [...(STORE_CONFIGS[country] ?? [])];
  const allStoresSet = new Set([...configStores, ...manifestStores]);
  const allStores = [...allStoresSet].sort();

  // 404 only when neither the config nor the manifest knows about this country.
  if (allStores.length === 0) {
    notFound();
  }

  const allCatalogs = await storage.listCatalogs({
    country,
    status: "ready",
  });
  const catalogs = allCatalogs.filter((c) => isRecentEnough(c.dateTo));
  const activeCatalogs = catalogs.filter((c) => isCatalogActive(c.dateTo));
  const expiredCatalogs = catalogs.filter((c) => !isCatalogActive(c.dateTo));

  const countryName = getCountryName(country);
  const storesWithCatalogs = [...new Set(activeCatalogs.map((c) => c.store))];

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
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <Header
        crumbs={[{ label: countryName }]}
      />
      <main className="container">
        <h1 className="page-title">{countryName}</h1>
        <p className="page-subtitle">
          {allStores.length} store{allStores.length !== 1 ? "s" : ""} &middot;{" "}
          {activeCatalogs.length} catalog{activeCatalogs.length !== 1 ? "s" : ""}
        </p>

        <p className="page-intro">
          {buildIntroText(countryName, activeCatalogs.length, storesWithCatalogs)}
        </p>

        {/* Store pills — all configured stores, not just those with live catalogs */}
        <div className="store-list">
          <Link href={`/${country}`}>
            <span className="store-pill store-pill-active">All</span>
          </Link>
          {allStores.map((store) => (
            <Link key={store} href={`/${country}/${store}`}>
              <span className="store-pill">{toDisplayName(store)}</span>
            </Link>
          ))}
        </div>

        <CatalogStoreRows catalogs={activeCatalogs} />

        {expiredCatalogs.length > 0 && (
          <details className="expired-section" open>
            <summary className="expired-section-title">
              Recently expired ({expiredCatalogs.length})
            </summary>
            <CatalogStoreRows catalogs={expiredCatalogs} muted />
          </details>
        )}
      </main>
    </>
  );
}
