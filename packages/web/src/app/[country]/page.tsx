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

/** ISO week number (Monday-based), computed from a Date */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Thursday of the current week → determines the year
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

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
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/${country}` },
    openGraph: { title, description, type: "website" },
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

function buildMastheadSubtitle(
  storesWithCatalogs: string[],
  activeCatalogCount: number,
): string {
  if (storesWithCatalogs.length === 0) {
    return "Quiet on the floor — fresh leaflets are due Monday morning.";
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
  const count = activeCatalogCount;
  return `This week — ${count} fresh ${count === 1 ? "edition" : "editions"} from ${storeList} — curated each Monday and Thursday.`;
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
  const activeCatalogs = catalogs.filter((c) => isCatalogActive(c.dateTo));
  const expiredCatalogs = catalogs.filter((c) => !isCatalogActive(c.dateTo));

  const countryName = getCountryName(country);
  const storesWithCatalogs = [...new Set(activeCatalogs.map((c) => c.store))];

  // Magazine issue metadata
  const now = new Date();
  const week = isoWeek(now);
  const year = now.getFullYear();
  const issueNum = String(week).padStart(3, "0");
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
        {/* Magazine masthead */}
        <div className="masthead">
          <p className="masthead-kicker">
            Issue &nbsp;&#x2116;{issueNum}&nbsp;&middot;&nbsp;Week {week}&nbsp;&middot;&nbsp;{year}
          </p>
          <hr className="masthead-rule" />
          <h1 className="masthead-title">{countryName}</h1>
          <p className="page-intro">
            {/^\p{L}/u.test(mastheadSubtitle.charAt(0)) && (
              <span className="drop-cap" aria-hidden="true">
                {mastheadSubtitle.charAt(0)}
              </span>
            )}
            {/^\p{L}/u.test(mastheadSubtitle.charAt(0))
              ? mastheadSubtitle.slice(1)
              : mastheadSubtitle}
          </p>
          <hr className="masthead-rule" />
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
