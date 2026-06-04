import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogStoreRows } from "@/components/CatalogStoreRows";
import { toDisplayName } from "@/lib/display-name";
import { STORE_CONFIGS } from "@/lib/store-configs";
import { isCatalogActive } from "@bestdeal/shared";
import type { CatalogSummary } from "@bestdeal/shared";
import { getCoverUrl } from "@/lib/image-url";
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
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  // Fetch active stores for richer title — fetch is deduplicated by Next.js
  const allCatalogs = await storage.listCatalogs({ country, status: "ready" });
  const storesWithCatalogs = [
    ...new Set(
      allCatalogs
        .filter((c) => isCatalogActive(c.dateTo))
        .map((c) => c.store),
    ),
  ];
  const storeNamesShort = storesWithCatalogs.slice(0, 3).map(toDisplayName);
  const moreCount = storesWithCatalogs.length - 3;
  const storeFragment =
    storeNamesShort.length > 0
      ? storeNamesShort.join(", ") +
        (moreCount > 0 ? ` & ${moreCount} more` : "")
      : null;

  const title = storeFragment
    ? `Weekly Catalogs in ${countryName} — ${monthYear} — ${storeFragment} · BestDeal`
    : `Weekly Catalogs in ${countryName} — ${monthYear} · BestDeal`;
  const description = `Browse weekly retail catalogs from stores in ${countryName}. Updated every Monday and Thursday.`;

  // Pick the freshest active catalog's cover as OG image
  const sortedActive = allCatalogs
    .filter((c) => isCatalogActive(c.dateTo))
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
  const coverUrl = sortedActive[0] ? getCoverUrl(sortedActive[0]) : undefined;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/${country}` },
    openGraph: {
      title,
      description,
      type: "website",
      ...(coverUrl && { images: [{ url: coverUrl }] }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(coverUrl && { images: [coverUrl] }),
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

/**
 * Priority-ordered variant types per store family.
 * The first matching type in the list wins within a (store, dateFrom, dateTo) group.
 */
const STORE_VARIANT_PRIORITY: Record<string, string[]> = {
  "aldi-sued": ["op", "vop", "op-mp"],
  "aldi-nord": ["op", "vop", "op-mp"],
  aldi: ["op", "vop", "op-mp"],
  kaufland: ["kdz", "hyper", "leaflet", "magazine", "wrapper", "inlet"],
};

/**
 * From a group of catalog variants sharing the same (store, dateFrom, dateTo),
 * pick the single canonical one to show on the country page.
 */
function pickCanonicalCatalog(group: CatalogSummary[]): CatalogSummary {
  if (group.length === 1) return group[0];

  const store = group[0].store;
  const priorities = STORE_VARIANT_PRIORITY[store];

  if (priorities) {
    for (const variant of priorities) {
      const match = group.find((c) => c.catalogType === variant);
      if (match) return match;
    }
    // Fell through all known priorities — return first remaining
    return group[0];
  }

  // Generic fallback: prefer catalog with no catalogType, then sort alphabetically
  const noType = group.find((c) => !c.catalogType);
  if (noType) return noType;

  return [...group].sort((a, b) =>
    (a.catalogType ?? "").localeCompare(b.catalogType ?? ""),
  )[0];
}

/**
 * Deduplicate a catalog list by (store, dateFrom, dateTo), keeping the canonical
 * variant per group. Preserves the original ordering of first-seen groups.
 */
function dedupeCatalogs(catalogs: CatalogSummary[]): CatalogSummary[] {
  const groups = new Map<string, CatalogSummary[]>();
  for (const catalog of catalogs) {
    const key = `${catalog.store}|${catalog.dateFrom}|${catalog.dateTo}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(catalog);
    } else {
      groups.set(key, [catalog]);
    }
  }
  return [...groups.values()].map(pickCanonicalCatalog);
}

function buildMastheadSubtitle(
  storesWithCatalogs: string[],
  activeCatalogCount: number,
): string {
  if (storesWithCatalogs.length === 0) {
    return "Fresh leaflets are due Monday morning.";
  }
  const count = activeCatalogCount;
  const storeCount = storesWithCatalogs.length;
  if (count === 1) {
    return "1 fresh catalog this week.";
  }
  return `${count} fresh catalogs across ${storeCount} ${storeCount === 1 ? "store" : "stores"} this week.`;
}

export default async function CountryPage({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country } = await params;
  const manifestStores = await storage.listStores(country);

  const configStores: string[] = [...(STORE_CONFIGS[country] ?? [])];
  const allStoresSet = new Set([...configStores, ...manifestStores]);
  const allStores = [...allStoresSet].sort();

  if (allStores.length === 0) {
    notFound();
  }

  const allCatalogs = await storage.listCatalogs({
    country,
    status: "ready",
  });
  const catalogs = allCatalogs.filter((c) => isRecentEnough(c.dateTo));
  const activeCatalogs = dedupeCatalogs(
    catalogs.filter((c) => isCatalogActive(c.dateTo)),
  );
  const expiredCatalogs = dedupeCatalogs(
    catalogs.filter((c) => !isCatalogActive(c.dateTo)),
  );

  const countryName = getCountryName(country);
  const storesWithCatalogs = [...new Set(activeCatalogs.map((c) => c.store))];

  const mastheadSubtitle = buildMastheadSubtitle(
    storesWithCatalogs,
    activeCatalogs.length,
  );

  const byline = `${allStores.length} store${allStores.length !== 1 ? "s" : ""} · ${activeCatalogs.length} catalog${activeCatalogs.length !== 1 ? "s" : ""} · updated weekly`;

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
      <Header crumbs={[{ label: countryName }]} />
      <main className="container">
        {/* Page masthead */}
        <div className="masthead">
          <p className="masthead-kicker">{countryName}</p>
          <h1 className="masthead-title">{mastheadSubtitle}</h1>
          <p className="masthead-byline">{byline}</p>
        </div>

        {/* Store filter pills */}
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
          <details className="expired-section">
            <summary className="expired-section-title">
              <span className="expired-section-label">Show older catalogs ({expiredCatalogs.length})</span>
              <span className="expired-section-label--open">Hide older catalogs ({expiredCatalogs.length})</span>
            </summary>
            <CatalogStoreRows catalogs={expiredCatalogs} muted />
          </details>
        )}
      </main>
    </>
  );
}
