import { notFound } from "next/navigation";
import { storage } from "@/lib/storage";
import { Header, getCountryName } from "@/components/Header";
import { CatalogGrid } from "@/components/CatalogGrid";
import Link from "next/link";

export const runtime = "edge";
export const revalidate = 300;

export default async function CountryPage({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country } = await params;
  const stores = await storage.listStores(country);

  if (stores.length === 0) {
    notFound();
  }

  const catalogs = await storage.listCatalogs({
    country,
    status: "ready",
  });

  const countryName = getCountryName(country);

  return (
    <>
      <Header
        crumbs={[{ label: countryName }]}
      />
      <main className="container">
        <h1 className="page-title">{countryName}</h1>
        <p className="page-subtitle">
          {stores.length} store{stores.length !== 1 ? "s" : ""} &middot;{" "}
          {catalogs.length} catalog{catalogs.length !== 1 ? "s" : ""}
        </p>

        {/* Store pills */}
        <div className="store-list">
          <Link href={`/${country}`}>
            <span className="store-pill store-pill-active">All</span>
          </Link>
          {stores.map((store) => (
            <Link key={store} href={`/${country}/${store}`}>
              <span className="store-pill">{store}</span>
            </Link>
          ))}
        </div>

        <CatalogGrid catalogs={catalogs} />
      </main>
    </>
  );
}
