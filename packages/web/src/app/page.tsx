import { storage } from "@/lib/storage";
import { Header } from "@/components/Header";
import { CountrySelector } from "@/components/CountrySelector";

export const runtime = "edge";
export const revalidate = 300;

/** ISO week number (Monday-based) */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export default async function HomePage() {
  let countries: Awaited<ReturnType<typeof storage.listCountries>> = [];
  try {
    countries = await storage.listCountries();
  } catch {
    // Empty bucket or CDN connection error — show empty state
  }

  const now = new Date();
  const week = isoWeek(now);
  const issueNum = String(week).padStart(3, "0");

  return (
    <>
      <Header />
      <main className="container">
        <div className="home-masthead">
          <p className="home-masthead-kicker">
            BestDeal &nbsp;&middot;&nbsp; Issue &nbsp;&#x2116;{issueNum}
          </p>
          <h1 className="home-masthead-title">Europe&rsquo;s<br />Catalog Index</h1>
          <p className="home-masthead-subtitle">
            Weekly leaflets from supermarkets, drugstores and hardware chains across the continent &mdash; curated twice a week.
          </p>
        </div>
        <CountrySelector countries={countries} />
      </main>
    </>
  );
}
