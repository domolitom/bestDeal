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

/** Rotation cycles -1.5°, 0°, +1.5° based on card index — SSR-stable */
function cardRotation(i: number): string {
  const rotations = ["-1.5deg", "0deg", "1.5deg"];
  return rotations[i % 3];
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
        <span className="empty-state-ornament">&#10022;</span>
        <span className="empty-state-kicker">On Press</span>
        <p className="empty-state-message">
          This issue is at the printers &mdash; fresh leaflets arrive Monday morning.
        </p>
      </div>
    );
  }

  const groups = groupByStore(catalogs);

  return (
    <div className="store-rows">
      {groups.map(({ store, catalogs: storeCatalogs }, groupIndex) => {
        const sectionNum = String(groupIndex + 1).padStart(2, "0");
        const countLabel = `${storeCatalogs.length} ${storeCatalogs.length === 1 ? "weekly leaflet" : "weekly leaflets"}`;
        const freshnestLabel = formatFreshest(storeCatalogs[0].dateFrom);

        return (
          <section
            key={store}
            className="store-row"
            style={{ "--row-index": groupIndex } as React.CSSProperties}
          >
            <div className="store-row-header">
              <span className="store-row-number">{sectionNum}</span>
              <span className="store-row-dash" aria-hidden="true" />
              <h3 className="store-row-title">{toDisplayName(store)}</h3>
            </div>
            <p className="store-row-meta">
              {countLabel} &middot; {freshnestLabel}
            </p>
            <div
              className={`store-row-cards${muted ? " store-row-cards--muted" : ""}`}
            >
              {storeCatalogs.map((catalog, i) => (
                <div
                  key={catalog.id}
                  className="store-row-card-wrapper"
                  style={
                    {
                      zIndex: storeCatalogs.length - i,
                      "--card-rotation": cardRotation(i),
                    } as React.CSSProperties
                  }
                >
                  <CatalogCard catalog={catalog} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
