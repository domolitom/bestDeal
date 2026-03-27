import type { CatalogSummary } from "@bestdeal/shared";
import { CatalogCard } from "./CatalogCard";

export function CatalogGrid({ catalogs }: { catalogs: CatalogSummary[] }) {
  if (catalogs.length === 0) {
    return (
      <div className="empty-state">
        <h3>No catalogs found</h3>
        <p>No catalogs available right now. Check back soon!</p>
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
