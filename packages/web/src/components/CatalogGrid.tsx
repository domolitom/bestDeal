import type { CatalogSummary } from "@bestdeal/shared";
import { CatalogCard } from "./CatalogCard";

export function CatalogGrid({ catalogs }: { catalogs: CatalogSummary[] }) {
  if (catalogs.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-message">
          No catalogs available yet &mdash; fresh leaflets arrive every Monday and Thursday.
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
