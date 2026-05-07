import Link from "next/link";
import type { Country } from "@bestdeal/shared";

/** Assign column span based on catalog count */
function spanForCount(count: number): number {
  if (count >= 8) return 4;
  if (count >= 4) return 3;
  return 2;
}

/** Font size class for country name based on span */
function fontSizeClass(span: number): string {
  if (span === 4) return "country-name--large";
  if (span === 3) return "country-name--mid";
  return "country-name--small";
}

export function CountrySelector({ countries }: { countries: Country[] }) {
  if (countries.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-ornament">&#10022;</span>
        <span className="empty-state-kicker">On Press</span>
        <p className="empty-state-message">
          This issue is at the printers &mdash; fresh leaflets arrive Monday morning.
        </p>
      </div>
    );
  }

  // Sort by catalog count descending, then alphabetically
  const activeCountries = countries
    .filter((c) => c.catalogCount > 0)
    .sort((a, b) => b.catalogCount - a.catalogCount || a.name.localeCompare(b.name));

  return (
    <div className="bento-countries">
      {activeCountries.map((country) => {
        const span = spanForCount(country.catalogCount);
        const nameClass = fontSizeClass(span);
        return (
          <Link
            key={country.code}
            href={`/${country.code}`}
            className="country-card"
            style={{ "--col-span": span } as React.CSSProperties}
          >
            <div className="country-flag">{country.flag}</div>
            <div className="country-info">
              <h3 className={`country-name ${nameClass}`}>{country.name}</h3>
              <div className="country-stats">
                {country.storeCount} store{country.storeCount !== 1 ? "s" : ""}{" "}
                &middot; {country.catalogCount} catalog
                {country.catalogCount !== 1 ? "s" : ""}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
