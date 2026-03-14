import { notFound } from "next/navigation";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogViewer } from "@/components/CatalogViewer";
import { FreshnessIndicator, StatusBadge } from "@/components/FreshnessIndicator";
import { formatDate } from "@bestdeal/shared";

export const runtime = "edge";
export const revalidate = 300;

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
          { label: store, href: `/${country}/${store}` },
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
              style={{ margin: 0, textTransform: "capitalize" }}
            >
              {store}
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
