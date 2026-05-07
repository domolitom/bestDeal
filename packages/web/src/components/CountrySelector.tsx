import Link from "next/link";
import type { Country } from "@bestdeal/shared";

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

  const activeCountries = countries.filter((c) => c.catalogCount > 0);

  return (
    <div className="grid-countries">
      {activeCountries.map((country) => (
        <Link key={country.code} href={`/${country.code}`}>
          <div className="country-card">
            <div className="country-flag">{country.flag}</div>
            <div className="country-info">
              <h3>{country.name}</h3>
              <div className="country-stats">
                {country.storeCount} store{country.storeCount !== 1 ? "s" : ""}{" "}
                &middot; {country.catalogCount} catalog
                {country.catalogCount !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
