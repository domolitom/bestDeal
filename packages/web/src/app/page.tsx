import { storage } from "@/lib/storage";
import { Header } from "@/components/Header";
import { CountrySelector } from "@/components/CountrySelector";
import { CarrotHero } from "@/components/CarrotHero";

export const runtime = "edge";
export const revalidate = 300; // ISR: revalidate every 5 minutes

export default async function HomePage() {
  let countries: Awaited<ReturnType<typeof storage.listCountries>> = [];
  try {
    countries = await storage.listCountries();
  } catch {
    // Empty bucket or R2 connection error — show empty state
  }

  return (
    <>
      <Header />
      <main className="container" style={{ textAlign: "center" }}>
        <CarrotHero />
        <h1 className="page-title">Which country do you live in?</h1>
        <p className="page-subtitle">
          Browse the latest catalogs from your favorite stores
        </p>
        <CountrySelector countries={countries} />
      </main>
    </>
  );
}
