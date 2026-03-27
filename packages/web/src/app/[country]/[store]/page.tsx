import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogGrid } from "@/components/CatalogGrid";
import { toDisplayName } from "@/lib/display-name";
import Link from "next/link";

export const runtime = "edge";
export const revalidate = 300;

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

  const allCatalogs = await storage.listCatalogs({
    country,
    store,
  });
  const catalogs = allCatalogs.filter((c) => isRecentEnough(c.dateTo));

  if (catalogs.length === 0) {
    // Check if the store actually exists (might just have no ready catalogs)
    const stores = await storage.listStores(country);
    if (!stores.includes(store)) {
      notFound();
    }
  }

  const countryName = getCountryName(country);
  const allStores = await storage.listStores(country);

  return (
    <>
      <Header
        crumbs={[
          { label: countryName, href: `/${country}` },
          { label: toDisplayName(store) },
        ]}
      />
      <main className="container">
        <h1 className="page-title">
          {toDisplayName(store)}
        </h1>
        <p className="page-subtitle">
          {catalogs.length} catalog{catalogs.length !== 1 ? "s" : ""} in{" "}
          {countryName}
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

        <CatalogGrid catalogs={catalogs} />
      </main>
    </>
  );
}
