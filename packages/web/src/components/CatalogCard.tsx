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

/** Format "FILED ·DD.MM" stamp from an ISO date string */
function formatFiledStamp(dateFrom: string): string {
  const d = new Date(dateFrom);
  if (isNaN(d.getTime())) return "FILED";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `FILED ·${dd}.${mm}`;
}

/** Format a date pair as "11 — 17 MAY" in the editorial style */
function formatCardDateRange(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return `${from} — ${to}`;

  const dayFrom = f.getDate();
  const dayTo = t.getDate();
  const monthFrom = f.toLocaleString("en-GB", { month: "short" }).toUpperCase();
  const monthTo = t.toLocaleString("en-GB", { month: "short" }).toUpperCase();

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
  const filedStamp = formatFiledStamp(catalog.dateFrom);

  return (
    <Link href={`/${catalog.country}/${catalog.store}/${catalog.id}`}>
      <div className="card">
        {/* Polaroid frame — image sits in a paper-white inset */}
        <div className="catalog-card-frame">
          <span className="catalog-card-stamp" aria-hidden="true">{filedStamp}</span>
          <CatalogCardImage
            src={coverUrl}
            alt={`${toDisplayName(catalog.store)} catalog ${catalog.dateFrom} to ${catalog.dateTo}`}
            storeName={toDisplayName(catalog.store)}
          />
        </div>
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
