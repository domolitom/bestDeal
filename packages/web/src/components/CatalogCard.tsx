import Link from "next/link";
import type { CatalogSummary } from "@bestdeal/shared";
import { formatDate } from "@bestdeal/shared";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { getCoverUrl } from "@/lib/image-url";
import { toDisplayName } from "@/lib/display-name";

function catalogTypeLabel(type: string): string | null {
  const labels: Record<string, string> = {
    // Kaufland types (extracted from DE_de_<TYPE> URL segment)
    kdz: "Weekly Deals",
    inlet: "Flyer Insert",
    hyper: "Hypermarket",
    // wrapper is a short promotional sleeve bundled with the main flyer —
    // not independently meaningful, so no badge shown (return null below)
    // Aldi Sued types (extracted from kw<n>-<yy>-<type> slug)
    op: "Special Offers",
    vop: "Advance Offers",
    "op-mp": "Marketplace Offers",
    // Aldi Sued / Aldi national+regional
    national: "National Offers",
    regional: "Regional Offers",
    // Generic platform types
    magazine: "Magazine",
    leaflet: "Leaflet",
  };
  return labels[type.toLowerCase()] ?? null;
}

export function CatalogCard({ catalog }: { catalog: CatalogSummary }) {
  const coverUrl = getCoverUrl(catalog);
  const typeLabel = catalog.catalogType
    ? catalogTypeLabel(catalog.catalogType)
    : null;

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
          {typeLabel !== null && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                color: "var(--text-secondary)",
              }}
            >
              {typeLabel}
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
