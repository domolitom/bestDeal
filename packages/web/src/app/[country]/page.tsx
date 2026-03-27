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
  params: Promise<{ country: string }>;
}): Promise<Metadata> {
  const { country } = await params;
  const countryName = getCountryName(country);
  const title = `${countryName} Catalogs — BestDeal`;
  const description = `Browse weekly retail catalogs from stores in ${countryName}.`;
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

  const allCatalogs = await storage.listCatalogs({
    country,
    status: "ready",
  });
  const catalogs = allCatalogs.filter((c) => isRecentEnough(c.dateTo));

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
              <span className="store-pill">{toDisplayName(store)}</span>
            </Link>
          ))}
        </div>

        <CatalogGrid catalogs={catalogs} />
      </main>
    </>
  );
}
