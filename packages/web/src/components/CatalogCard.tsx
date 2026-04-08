import Link from "next/link";
import type { CatalogSummary } from "@bestdeal/shared";
import { formatDate } from "@bestdeal/shared";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { getCoverUrl } from "@/lib/image-url";
import { toDisplayName } from "@/lib/display-name";

function catalogTypeLabel(type: string): string | null {
  const labels: Record<string, string> = {
    // Kaufland types
    kdz: "Weekly Deals",
    inlet: "Flyer Insert",
    op: "Special Offers",
    // Aldi types
    national: "National Offers",
    regional: "Regional Offers",
  };
  return labels[type.toLowerCase()] ?? type;
}

export function CatalogCard({ catalog }: { catalog: CatalogSummary }) {
  const coverUrl = getCoverUrl(catalog);

  return (
    <Link href={`/${catalog.country}/${catalog.store}/${catalog.id}`}>
      <div className="card">
        <img
          className="catalog-card-image"
          src={coverUrl}
          alt={`${toDisplayName(catalog.store)} catalog ${catalog.dateFrom} - ${catalog.dateTo}`}
          loading="lazy"
        />
        <div className="catalog-card-info">
          <span className="catalog-card-store">{toDisplayName(catalog.store)}</span>
          {catalog.catalogType && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                color: "var(--text-secondary)",
              }}
            >
              {catalogTypeLabel(catalog.catalogType)}
            </span>
          )}
          <div className="catalog-card-dates">
            {formatDate(catalog.dateFrom)} - {formatDate(catalog.dateTo)}
          </div>
          <div style={{ marginTop: 6 }}>
            <FreshnessIndicator dateTo={catalog.dateTo} />
          </div>
        </div>
      </div>
    </Link>
  );
}
