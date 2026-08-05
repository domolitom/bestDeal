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
    storeCatalogs.sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
    const latestDateFrom = storeCatalogs[0].dateFrom;
    groups.push({ store, catalogs: storeCatalogs, latestDateFrom });
  }

  groups.sort((a, b) => b.latestDateFrom.localeCompare(a.latestDateFrom));
  return groups;
}

/** Format "freshest DD MMM" meta line */
function formatFreshest(dateFrom: string): string {
  const d = new Date(dateFrom);
  if (isNaN(d.getTime())) return dateFrom;
  const day = d.getDate();
  const month = d.toLocaleString("en-GB", { month: "long" });
  return `freshest ${day} ${month}`;
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
        <p className="empty-state-message">
          No catalogs available yet &mdash; fresh leaflets arrive every Monday and Thursday.
        </p>
      </div>
    );
  }

  const groups = groupByStore(catalogs);

  return (
    <div className="store-rows">
      {groups.map(({ store, catalogs: storeCatalogs }, groupIndex) => {
        const countLabel = `${storeCatalogs.length} ${storeCatalogs.length === 1 ? "leaflet" : "leaflets"}`;
        const freshnestLabel = formatFreshest(storeCatalogs[0].dateFrom);

        return (
          <div key={store}>
            {groupIndex > 0 && (
              <div className="section-divider" aria-hidden="true" />
            )}
            <section
              className="store-row"
              style={{ "--row-index": groupIndex } as React.CSSProperties}
            >
              <div className="store-row-header">
                <h3 className="store-row-title">{toDisplayName(store)}</h3>
              </div>
              <p className="store-row-meta">
                {countLabel} &middot; {freshnestLabel}
              </p>
              <div
                className={`store-row-cards${muted ? " store-row-cards--muted" : ""}`}
              >
                {storeCatalogs.map((catalog) => (
                  <div
                    key={catalog.id}
                    className="store-row-card-wrapper"
                  >
                    <CatalogCard catalog={catalog} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
