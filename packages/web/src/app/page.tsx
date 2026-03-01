import { storage } from "@/lib/storage";
import { Header } from "@/components/Header";
import { CountrySelector } from "@/components/CountrySelector";

export const revalidate = 300; // ISR: revalidate every 5 minutes

export default async function HomePage() {
  const countries = await storage.listCountries();

  return (
    <>
      <Header />
      <main className="container">
        <h1 className="page-title">Browse Catalogs</h1>
        <p className="page-subtitle">
          Weekly retail catalogs from stores across Europe
        </p>
        <CountrySelector countries={countries} />
      </main>
    </>
  );
}
