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

  return (
    <>
      <Header
        crumbs={[
          { label: countryName, href: `/${country}` },
          { label: toDisplayName(store), href: `/${country}/${store}` },
          {
            label: `${formatDate(catalog.dateFrom)} - ${formatDate(catalog.dateTo)}`,
          },
        ]}
      />
      <main>
        <div className="container" style={{ paddingTop: 24, paddingBottom: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h1
              className="page-title"
              style={{ margin: 0 }}
            >
              {toDisplayName(store)}
            </h1>
            {catalog.catalogType && (
              <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
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
              marginTop: 8,
              marginBottom: 24,
            }}
          >
            <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              {formatDate(catalog.dateFrom)} - {formatDate(catalog.dateTo)}
            </span>
            <FreshnessIndicator dateTo={catalog.dateTo} />
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {catalog.pages.length} pages
            </span>
          </div>
        </div>

        <CatalogViewer pages={catalog.pages} catalogId={catalog.id} />
      </main>
    </>
  );
}
