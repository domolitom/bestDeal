import Link from "next/link";
import type { Country } from "@bestdeal/shared";

export function CountrySelector({ countries }: { countries: Country[] }) {
  if (countries.length === 0) {
    return (
      <div className="empty-state">
        <h3>No countries available</h3>
        <p>No countries available right now. Check back soon!</p>
      </div>
    );
  }

  const activeCountries = countries.filter((c) => c.catalogCount > 0);

  return (
    <div className="grid-countries">
      {activeCountries.map((country) => (
        <Link key={country.code} href={`/${country.code}`}>
          <div className="card country-card">
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
