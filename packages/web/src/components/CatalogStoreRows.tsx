import type { CatalogSummary } from "@bestdeal/shared";
import { CatalogCard } from "./CatalogCard";
import { toDisplayName } from "@/lib/display-name";

interface StoreGroup {
  store: string;
  catalogs: CatalogSummary[];
  latestDateFrom: string;
}

function groupByStore(catalogs: CatalogSummary[]): StoreGroup[] {
  const map = new Map<string, CatalogSummary[]>();
  for (const catalog of catalogs) {
    const group = map.get(catalog.store);
    if (group) {
      group.push(catalog);
    } else {
      map.set(catalog.store, [catalog]);
    }
  }

  const groups: StoreGroup[] = [];
  for (const [store, storeCatalogs] of map) {
    // Sort each store's catalogs by dateFrom descending (newest first)
    storeCatalogs.sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
    const latestDateFrom = storeCatalogs[0].dateFrom;
    groups.push({ store, catalogs: storeCatalogs, latestDateFrom });
  }

  // Sort stores by their most recent catalog, newest first
  groups.sort((a, b) => b.latestDateFrom.localeCompare(a.latestDateFrom));

  return groups;
}

export function CatalogStoreRows({
  catalogs,
  muted = false,
}: {
  catalogs: CatalogSummary[];
  muted?: boolean;
}) {
  if (catalogs.length === 0) {
    return (
      <div className="empty-state">
        <h3>No catalogs found</h3>
        <p>No catalogs available right now. Check back soon!</p>
      </div>
    );
  }

  const groups = groupByStore(catalogs);

  return (
    <div className="store-rows">
      {groups.map(({ store, catalogs: storeCatalogs }) => (
        <section key={store} className="store-row">
          <h3 className="store-row-title">
            {toDisplayName(store)}
            <span className="store-row-count">
              {storeCatalogs.length}{" "}
              {storeCatalogs.length === 1 ? "catalog" : "catalogs"}
            </span>
          </h3>
          <div className={`store-row-cards${muted ? " store-row-cards--muted" : ""}`}>
            {storeCatalogs.map((catalog, i) => (
              <div
                key={catalog.id}
                className="store-row-card-wrapper"
                style={{ zIndex: storeCatalogs.length - i }}
              >
                <CatalogCard catalog={catalog} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
