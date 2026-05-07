import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogViewer } from "@/components/CatalogViewer";
import { FreshnessIndicator, StatusBadge } from "@/components/FreshnessIndicator";
import { formatDate } from "@bestdeal/shared";
import { toDisplayName } from "@/lib/display-name";
import { getCoverUrl } from "@/lib/image-url";

export const runtime = "edge";
export const revalidate = 300;

const BASE_URL = "https://best-deal-shops.com";

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
  const dateRange = `${formatDate(catalog.dateFrom)} to ${formatDate(catalog.dateTo)}`;
  const title = `${storeName} ${countryName} — ${dateRange} — BestDeal`;
  const description = `View the ${storeName} catalog in ${countryName} valid from ${dateRange}.`;
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
        item: `${BASE_URL}/${country}/${store}/${catalogId}`,
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
      </main>
    </>
  );
}
