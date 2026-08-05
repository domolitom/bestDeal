import Link from "next/link";
import type { Country } from "@bestdeal/shared";

export function CountrySelector({ countries }: { countries: Country[] }) {
  if (countries.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-message">
          No catalogs available yet &mdash; fresh leaflets arrive every Monday and Thursday.
        </p>
      </div>
    );
  }

  // Sort by catalog count descending, then alphabetically
  const activeCountries = countries
    .filter((c) => c.catalogCount > 0)
    .sort((a, b) => b.catalogCount - a.catalogCount || a.name.localeCompare(b.name));

  return (
    <div className="country-grid">
      {activeCountries.map((country) => (
        <Link
          key={country.code}
          href={`/${country.code}`}
          className="country-card"
        >
          <div className="country-flag">{country.flag}</div>
          <div className="country-info">
            <h3 className="country-name">{country.name}</h3>
            <div className="country-stats">
              {country.storeCount} store{country.storeCount !== 1 ? "s" : ""}{" "}
              &middot; {country.catalogCount} catalog
              {country.catalogCount !== 1 ? "s" : ""}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
