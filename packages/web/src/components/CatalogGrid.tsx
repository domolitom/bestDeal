import type { CatalogSummary } from "@bestdeal/shared";
import { CatalogCard } from "./CatalogCard";

export function CatalogGrid({ catalogs }: { catalogs: CatalogSummary[] }) {
  if (catalogs.length === 0) {
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

  return (
    <div className="grid-catalogs">
      {catalogs.map((catalog) => (
        <CatalogCard key={catalog.id} catalog={catalog} />
      ))}
    </div>
  );
}
