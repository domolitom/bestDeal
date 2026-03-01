import Link from "next/link";
import type { CatalogSummary } from "@bestdeal/shared";
import { formatDate } from "@bestdeal/shared";
import { StatusBadge, FreshnessIndicator } from "./FreshnessIndicator";

export function CatalogCard({ catalog }: { catalog: CatalogSummary }) {
  const coverUrl = `/data/catalogs/${catalog.country}/${catalog.store}/${catalog.id}/cover.jpg`;

  return (
    <Link href={`/${catalog.country}/${catalog.store}/${catalog.id}`}>
      <div className="card">
        <img
          className="catalog-card-image"
          src={coverUrl}
          alt={`${catalog.store} catalog ${catalog.dateFrom} - ${catalog.dateTo}`}
          loading="lazy"
        />
        <div className="catalog-card-info">
          <span className="catalog-card-store">{catalog.store}</span>
          {catalog.catalogType && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                color: "var(--text-secondary)",
              }}
            >
              {catalog.catalogType}
            </span>
          )}
          <div className="catalog-card-dates">
            {formatDate(catalog.dateFrom)} - {formatDate(catalog.dateTo)}
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <StatusBadge dateTo={catalog.dateTo} />
            <FreshnessIndicator dateTo={catalog.dateTo} />
          </div>
        </div>
      </div>
    </Link>
  );
}
