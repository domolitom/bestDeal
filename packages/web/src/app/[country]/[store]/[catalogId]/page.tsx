import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogViewer } from "@/components/CatalogViewer";
import { FreshnessIndicator, StatusBadge } from "@/components/FreshnessIndicator";
import { CatalogCard } from "@/components/CatalogCard";
import { formatDate, isCatalogActive } from "@bestdeal/shared";
import type { CatalogSummary } from "@bestdeal/shared";
import { toDisplayName } from "@/lib/display-name";
import { getCoverUrl } from "@/lib/image-url";
import { STORE_CONFIGS } from "@/lib/store-configs";

export const runtime = "edge";
export const revalidate = 300;

const BASE_URL = "https://best-deal-shops.com";

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

function pickCanonicalCatalog(group: CatalogSummary[]): CatalogSummary {
  if (group.length === 1) return group[0];
  const store = group[0].store;
  const priorities = STORE_VARIANT_PRIORITY[store];
  if (priorities) {
    for (const variant of priorities) {
      const match = group.find((c) => c.catalogType === variant);
      if (match) return match;
    }
    return group[0];
  }
  const noType = group.find((c) => !c.catalogType);
  if (noType) return noType;
  return [...group].sort((a, b) =>
    (a.catalogType ?? "").localeCompare(b.catalogType ?? ""),
  )[0];
}

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

/** Irregular rotation cycle — SSR-stable, feels less pattern-y */
function cardRotation(i: number): string {
  const rotations = ["-1.2deg", "0.4deg", "-0.6deg", "1.1deg", "-0.3deg"];
  return rotations[i % 5];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string; store: string; catalogId: string }>;
}): Promise<Metadata> {
  const { country, store, catalogId } = await params;
  const catalog = await storage.getCatalog(catalogId);
  if (!catalog) {
    return { title: "Catalog not found — BestDeal" };
  }
  const countryName = getCountryName(country);
  const storeName = toDisplayName(store);
  const dateRange = `${formatDate(catalog.dateFrom)} – ${formatDate(catalog.dateTo)}`;
  const pageInfo = catalog.pageCount ? ` (${catalog.pageCount} pages)` : "";
  const title = `${storeName} ${countryName} Catalog ${dateRange}${pageInfo} · BestDeal`;
  const description = `View the ${storeName} ${countryName} weekly leaflet for ${dateRange}. ${catalog.pageCount ?? "Multiple"} pages of deals and special offers.`;
  const coverUrl = getCoverUrl(catalog);
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/${country}/${store}/${catalogId}` },
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: coverUrl }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [coverUrl],
    },
  };
}

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ country: string; store: string; catalogId: string }>;
}) {
  const { country, store, catalogId } = await params;
  const catalog = await storage.getCatalog(catalogId);

  if (!catalog) {
    notFound();
  }

  const countryName = getCountryName(country);
  const storeName = toDisplayName(store);
  const pageUrl = `${BASE_URL}/${country}/${store}/${catalogId}`;
  const coverUrl = getCoverUrl(catalog);
  // scrapedAt is optional on CatalogMeta; fall back to dateFrom for temporal signals
  const publishedDate = catalog.scrapedAt ?? catalog.dateFrom;

  // "More from {storeName}" — same store, exclude current, up to 4
  const allStoreCatalogs = await storage.listCatalogs({ country, store, status: "ready" });
  const moreCatalogs = dedupeCatalogs(
    allStoreCatalogs.filter((c) => isRecentEnough(c.dateTo) && c.id !== catalogId),
  ).slice(0, 4);

  // "Other stores in {countryName}" — other stores with at least one active catalog, up to 6
  const manifestStores = await storage.listStores(country);
  const configStores: string[] = [...(STORE_CONFIGS[country] ?? [])];
  const allStoresInCountry = [...new Set([...configStores, ...manifestStores])].sort();
  const otherStores = allStoresInCountry.filter((s) => s !== store);

  const otherStoreEntries: { store: string; catalog: CatalogSummary | null }[] = [];
  for (const otherStore of otherStores) {
    if (otherStoreEntries.length >= 6) break;
    const storeCatalogs = await storage.listCatalogs({ country, store: otherStore, status: "ready" });
    const activeCatalogs = storeCatalogs
      .filter((c) => isCatalogActive(c.dateTo))
      .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
    if (activeCatalogs.length > 0) {
      otherStoreEntries.push({ store: otherStore, catalog: activeCatalogs[0] });
    }
  }

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
      {
        "@type": "ListItem",
        position: 4,
        name: `${formatDate(catalog.dateFrom)} – ${formatDate(catalog.dateTo)}`,
        item: pageUrl,
      },
    ],
  };

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${storeName} catalog — ${formatDate(catalog.dateFrom)} to ${formatDate(catalog.dateTo)}`,
    image: [coverUrl],
    datePublished: publishedDate,
    dateModified: publishedDate,
    publisher: {
      "@type": "Organization",
      name: "BestDeal",
      url: BASE_URL,
    },
    mainEntityOfPage: pageUrl,
    expires: catalog.dateTo,
  };

  const offerJsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: `${storeName} weekly leaflet`,
    url: pageUrl,
    image: coverUrl,
    validFrom: catalog.dateFrom,
    validThrough: catalog.dateTo,
    availabilityStarts: catalog.dateFrom,
    availabilityEnds: catalog.dateTo,
    seller: {
      "@type": "Organization",
      name: storeName,
    },
    areaServed: {
      "@type": "Country",
      name: countryName,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(offerJsonLd) }}
      />
      <Header
        crumbs={[
          { label: countryName, href: `/${country}` },
          { label: storeName, href: `/${country}/${store}` },
          {
            label: `${formatDate(catalog.dateFrom)} – ${formatDate(catalog.dateTo)}`,
          },
        ]}
      />
      <main>
        <div
          className="container"
          style={{ paddingTop: 28, paddingBottom: 8 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <h1 className="page-title" style={{ margin: 0 }}>
              {storeName}
            </h1>
            {catalog.catalogType && (
              <span
                style={{
                  fontFamily: "var(--font-display, serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-lg)",
                  color: "var(--ink-soft)",
                }}
              >
                {catalog.catalogType}
              </span>
            )}
            <StatusBadge dateTo={catalog.dateTo} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "var(--text-sm)",
                color: "var(--ink-faded)",
                letterSpacing: "0.04em",
              }}
            >
              {formatDate(catalog.dateFrom)} &ndash; {formatDate(catalog.dateTo)}
            </span>
            <FreshnessIndicator dateTo={catalog.dateTo} />
            <span
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "var(--text-xs)",
                color: "var(--ink-faded)",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}
            >
              {catalog.pages.length} pages
            </span>
          </div>
        </div>

        <CatalogViewer
          pages={catalog.pages}
          catalogId={catalog.id}
          storeName={storeName}
          dateFrom={catalog.dateFrom}
          dateTo={catalog.dateTo}
        />

        {/* Related content sections */}
        <div className="container" style={{ paddingTop: 0, paddingBottom: 48 }}>
          {moreCatalogs.length > 0 && (
            <>
              <div className="section-divider" aria-hidden="true" style={{ marginTop: 56 }}>
                <span className="section-divider-rule" />
                <span className="section-divider-ornament">&#8258;</span>
                <span className="section-divider-rule" />
              </div>
              <section style={{ marginTop: 36, marginBottom: 0 }}>
                <h2
                  style={{
                    fontFamily: "var(--font-display, serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: "var(--text-3xl)",
                    letterSpacing: "-0.02em",
                    color: "var(--ink)",
                    lineHeight: 1,
                    marginBottom: 8,
                  }}
                >
                  More from {storeName}
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-body, sans-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-sm)",
                    color: "var(--ink-soft)",
                    marginBottom: 24,
                  }}
                >
                  Recent editions from {storeName} in {countryName}
                </p>
                <div className="related-catalog-row">
                  {moreCatalogs.map((c, i) => (
                    <div
                      key={c.id}
                      className="store-row-card-wrapper"
                      style={
                        {
                          zIndex: moreCatalogs.length - i,
                          "--card-rotation": cardRotation(i),
                        } as React.CSSProperties
                      }
                    >
                      <CatalogCard catalog={c} />
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {otherStoreEntries.length > 0 && (
            <>
              <div className="section-divider" aria-hidden="true" style={{ marginTop: moreCatalogs.length > 0 ? 56 : 56 }}>
                <span className="section-divider-rule" />
                <span className="section-divider-ornament">&#8258;</span>
                <span className="section-divider-rule" />
              </div>
              <section style={{ marginTop: 36 }}>
                <h2
                  style={{
                    fontFamily: "var(--font-display, serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: "var(--text-3xl)",
                    letterSpacing: "-0.02em",
                    color: "var(--ink)",
                    lineHeight: 1,
                    marginBottom: 8,
                  }}
                >
                  Other stores in {countryName}
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-body, sans-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-sm)",
                    color: "var(--ink-soft)",
                    marginBottom: 24,
                  }}
                >
                  Fresh catalogs from other retailers this week
                </p>
                <div className="other-stores-grid">
                  {otherStoreEntries.map(({ store: otherStore, catalog: otherCatalog }) => {
                    const otherCoverUrl = otherCatalog ? getCoverUrl(otherCatalog) : null;
                    return (
                      <Link
                        key={otherStore}
                        href={`/${country}/${otherStore}`}
                        className="other-store-tile"
                      >
                        {otherCoverUrl && (
                          <div className="other-store-thumb">
                            <img
                              src={otherCoverUrl}
                              alt={`${toDisplayName(otherStore)} catalog cover`}
                              loading="lazy"
                            />
                          </div>
                        )}
                        <span className="other-store-name">
                          {toDisplayName(otherStore)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </>
  );
}
