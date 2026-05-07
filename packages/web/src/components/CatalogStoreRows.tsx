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

/** Irregular rotation cycle — SSR-stable, feels less pattern-y */
function cardRotation(i: number): string {
  const rotations = ["-1.2deg", "0.4deg", "-0.6deg", "1.1deg", "-0.3deg"];
  return rotations[i % 5];
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
        const isLast = groupIndex === groups.length - 1;

        return (
          <div key={store}>
            {groupIndex > 0 && (
              <div className="section-divider" aria-hidden="true">
                <span className="section-divider-rule" />
                <span className="section-divider-ornament">&#8258;</span>
                <span className="section-divider-rule" />
              </div>
            )}
            <section
              className="store-row"
              style={{ "--row-index": groupIndex } as React.CSSProperties}
            >
              <div className="store-row-header">
                <span className="store-row-number store-row-number--display">{sectionNum}</span>
                <span className="store-row-fleuron" aria-hidden="true">&#10086;</span>
                <h3 className="store-row-title store-row-title--swash">{toDisplayName(store)}</h3>
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
            {isLast && (
              <div className="section-divider" aria-hidden="true">
                <span className="section-divider-rule" />
                <span className="section-divider-ornament">&#8258;</span>
                <span className="section-divider-rule" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
