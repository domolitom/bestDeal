import { notFound } from "next/navigation";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogGrid } from "@/components/CatalogGrid";
import Link from "next/link";

export const runtime = "edge";
export const revalidate = 300;

export default async function StorePage({
  params,
}: {
  params: Promise<{ country: string; store: string }>;
}) {
  const { country, store } = await params;

  const catalogs = await storage.listCatalogs({
    country,
    store,
  });

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
          { label: store },
        ]}
      />
      <main className="container">
        <h1 className="page-title" style={{ textTransform: "capitalize" }}>
          {store}
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
                {s}
              </span>
            </Link>
          ))}
        </div>

        <CatalogGrid catalogs={catalogs} />
      </main>
    </>
  );
}
