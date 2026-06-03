import Link from "next/link";
import type { CatalogSummary } from "@bestdeal/shared";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { CatalogCardImage } from "./CatalogCardImage";
import { getCoverUrl } from "@/lib/image-url";
import { toDisplayName } from "@/lib/display-name";

function catalogTypeLabel(type: string): string | null {
  const labels: Record<string, string> = {
    kdz: "Weekly Deals",
    inlet: "Flyer Insert",
    hyper: "Hypermarket",
    op: "Special Offers",
    vop: "Advance Offers",
    "op-mp": "Marketplace Offers",
    national: "National Offers",
    regional: "Regional Offers",
    magazine: "Magazine",
    leaflet: "Leaflet",
  };
  return labels[type.toLowerCase()] ?? null;
}

/** Format a date pair as "11 — 17 May" */
function formatCardDateRange(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return `${from} — ${to}`;

  const dayFrom = f.getDate();
  const dayTo = t.getDate();
  const monthFrom = f.toLocaleString("en-GB", { month: "short" });
  const monthTo = t.toLocaleString("en-GB", { month: "short" });

  if (monthFrom === monthTo) {
    return `${dayFrom} — ${dayTo} ${monthTo}`;
  }
  return `${dayFrom} ${monthFrom} — ${dayTo} ${monthTo}`;
}

export function CatalogCard({ catalog }: { catalog: CatalogSummary }) {
  const coverUrl = getCoverUrl(catalog);
  const typeLabel = catalog.catalogType
    ? catalogTypeLabel(catalog.catalogType)
    : null;
  const dateRange = formatCardDateRange(catalog.dateFrom, catalog.dateTo);

  return (
    <Link href={`/${catalog.country}/${catalog.store}/${catalog.id}`}>
      <div className="card">
        <CatalogCardImage
          src={coverUrl}
          alt={`${toDisplayName(catalog.store)} catalog ${catalog.dateFrom} to ${catalog.dateTo}`}
          storeName={toDisplayName(catalog.store)}
        />
        <div className="catalog-card-info">
          <span className="catalog-card-store">{toDisplayName(catalog.store)}</span>
          {typeLabel !== null && (
            <span className="catalog-card-type">{typeLabel}</span>
          )}
          <div className="catalog-card-dates">{dateRange}</div>
          <FreshnessIndicator dateTo={catalog.dateTo} />
        </div>
      </div>
    </Link>
  );
}
